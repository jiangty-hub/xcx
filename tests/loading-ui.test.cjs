const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = process.env.LOADING_TEST_ROOT || path.join(__dirname, '..')
function setup({ cancel = false, failShow = false, failHide = false } = {}) {
  const events = [], timers = []
  const uni = {
    showLoading(options) { events.push('show'); if (failShow) options.fail({ errMsg: 'unavailable' }) },
    hideLoading(options) {
      events.push('hide')
      setImmediate(() => {
        if (failHide) options.fail({ errMsg: "hideLoading:fail toast can't be found" })
        events.push('hidden'); options.complete()
      })
    },
    showToast(options) { events.push('toast:' + options.title) },
    chooseImage(options) { cancel ? options.fail({ errMsg: 'chooseImage:fail cancel' }) : options.success({ tempFilePaths: ['/tmp/a.jpg'] }) },
    getStorageSync() { return 'user' }, setStorageSync() {}, removeStorageSync() {},
    login(options) { options.success({ code: 'code' }) }
  }
  const context = {
    uni, console: { warn() {}, error() {} }, module: { exports: {} },
    setTimeout(fn) { timers.push(fn) },
    leaveGuard: {}, notlogin: {}, loggedin: {}, applyNewToken() {}, getAuthToken() { return 'token' },
    clearAuthStorage() {}, isAuthExpiredResult(r) { return r.code === 401 },
    addPendingCleanup() {},
    uniCloud: {
      importObject() { return {} },
      async uploadFile() { return { fileID: 'file' } },
      async getTempFileURL() { return { fileList: [] } },
      async callFunction() { return { result: { code: 0, token: 'token' } } }
    }
  }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(path.join(root, 'utils/loading.js'), 'utf8').replace('export function', 'function'), context)
  function page(file) {
    const script = fs.readFileSync(path.join(root, file), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
      .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?\r?$/gm, '')
      .replace('export default', 'module.exports =')
    // Each page has its own module scope, while the loading manager is shared.
    vm.runInContext('(function(){' + script + '\n})()', context)
    const def = context.module.exports
    return Object.assign(def.data(), def.methods, { formDisabled: false, preparePageLeave: async () => {} })
  }
  return { events, context, page, begin: context.beginLoading }
}
test('repeated close is idempotent and waits for native completion', async () => {
  const h = setup(), stop = h.begin()
  const first = stop(), second = stop()
  assert.deepEqual(h.events, ['show', 'hide'])
  await Promise.all([first, second])
  assert.deepEqual(h.events, ['show', 'hide', 'hidden'])
})
test('one request cannot close another active loading request', async () => {
  const h = setup(), a = h.begin(), b = h.begin()
  await a(); assert.deepEqual(h.events, ['show', 'show'])
  await b(); assert.equal(h.events.filter(x => x === 'hide').length, 1)
})
test('failed show does not trigger a hide', async () => {
  const h = setup({ failShow: true }); await h.begin()()
  assert.deepEqual(h.events, ['show'])
})
test('already absent native loading is handled through callbacks', async () => {
  const h = setup({ failHide: true }); await h.begin()()
  assert.deepEqual(h.events, ['show', 'hide', 'hidden'])
})
test('cancel avatar picker never hides an unopened loading', async () => {
  const h = setup({ cancel: true }), page = h.page('pages/profile/edit.vue')
  await page.chooseAvatar()
  assert.deepEqual(h.events, ['toast:已取消'])
  assert.equal(page.avatarUploading, false)
})
test('avatar upload closes before success toast, once', async () => {
  const h = setup(), page = h.page('pages/profile/edit.vue')
  await page.chooseAvatar()
  assert.deepEqual(h.events, ['show', 'hide', 'hidden', 'toast:头像已上传'])
})
test('avatar upload failure closes before error toast', async () => {
  const h = setup(), page = h.page('pages/profile/edit.vue')
  h.context.uniCloud.uploadFile = async () => { throw new Error('upload failed') }
  await page.chooseAvatar()
  assert.deepEqual(h.events, ['show', 'hide', 'hidden', 'toast:upload failed'])
})
for (const failure of [false, true]) test('profile save ordering, failure=' + failure, async () => {
  const h = setup(), page = h.page('pages/profile/edit.vue')
  page.nickname = 'name'; page.applyAvatarCleanup = () => {}
  if (failure) h.context.uniCloud.callFunction = async () => { throw new Error('save failed') }
  await page.save()
  assert.deepEqual(h.events, ['show', 'hide', 'hidden', 'toast:' + (failure ? 'save failed' : '已保存')])
  assert.equal(page.saving, false)
})
test('expired session closes before login warning', async () => {
  const h = setup(), page = h.page('pages/profile/edit.vue'); page.nickname = 'name'
  h.context.uniCloud.callFunction = async () => ({ result: { code: 401 } })
  await page.save()
  assert.deepEqual(h.events, ['show', 'hide', 'hidden', 'toast:登录已失效，请重新登录'])
})
test('force close, finally and unload do not close twice', async () => {
  const h = setup(), page = h.page('pages/addDish/addDish.vue')
  page.safeShowLoading(); await page.safeHideLoading(true)
  await page.safeHideLoading(); await page.safeHideLoading(true)
  assert.deepEqual(h.events, ['show', 'hide', 'hidden'])
})
test('login closes before result toast', async () => {
  const h = setup(), page = h.page('pages/my/my.vue')
  page.refresh = async () => ({ status: 'success', profileLoaded: true, permissionLoaded: true })
  await page.weixinLogin()
  assert.deepEqual(h.events, ['show', 'hide', 'hidden', 'toast:登录成功'])
})
for (const failure of [false, true]) test('delete closes before feedback/navigation, failure=' + failure, async () => {
  const h = setup()
  h.context.uniCloud.importObject = () => ({ async deleteFood() {
    if (failure) throw new Error('delete failed')
    return { cleanup: { error: 'cleanup pending' } }
  } })
  h.context.getCurrentPages = () => []
  h.context.uni.reLaunch = () => h.events.push('navigate')
  let done
  h.context.uni.showModal = options => { done = options.success({ confirm: true }) }
  const page = h.page('subpkg/goods_detail/goods_detail.vue')
  page.foodId = 'food'; page.canManage = true
  await page.onDelete(); await done
  assert.deepEqual(h.events, failure
    ? ['show', 'hide', 'hidden', 'toast:delete failed']
    : ['show', 'hide', 'hidden', 'toast:菜品已删除，部分旧图片未清理', 'navigate'])
  assert.equal(page.deleting, false)
})
