const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sourcePath = process.env.CATEGORY_PAGE_SOURCE || path.join(__dirname, '../pages/category/category.vue')
const source = fs.readFileSync(sourcePath, 'utf8')
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(setImmediate)
const rows = (id, page = 1, hasMore = false) => ({ list: [{ _id: `${id}-${page}` }], hasMore })
function setup({ selected, categories = [{ cate_id: 0, name: '牛肉类' }, { cate_id: 4, name: '猪肉类' }], getCategories, getFoods } = {}) {
  const storage = new Map(), calls = [], toasts = []
  if (selected !== undefined) storage.set('selectedCategoryId', selected)
  let categoryCalls = 0
  const resume = { seq: 0, shouldRefresh: false }
  const service = {
    async getCategories() { categoryCalls++; return getCategories ? getCategories(categoryCalls) : categories },
    async getFoodsByCategory(id, options) { calls.push({ id, ...options }); return getFoods ? getFoods(id, options, calls.length) : rows(id) }
  }
  const globals = {
    module: { exports: {} }, console: { error() {} },
    uniCloud: { importObject: () => service },
    getResumeRefreshState: last => ({ ...resume, shouldRefresh: resume.shouldRefresh && last !== resume.seq }),
    uni: {
      getWindowInfo: () => ({ windowHeight: 800 }),
      getStorageSync: key => storage.has(key) ? storage.get(key) : '',
      removeStorageSync: key => storage.delete(key)
    }
  }
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^[\t ]*import .*$/mg, '').replace('export default', 'module.exports =')
  vm.runInNewContext(script, globals, { filename: sourcePath })
  const definition = globals.module.exports
  const page = Object.assign(definition.data(), definition.methods, { $showError: (...args) => toasts.push(args) })
  return { page, calls, storage, resume, toasts, categoryCalls: () => categoryCalls,
    load: () => definition.onLoad.call(page), show: () => definition.onShow.call(page),
    unload: () => definition.onUnload.call(page) }
}

for (const selected of [undefined, 0, '4', 'missing']) {
  test(`首次进入仅加载最终分类，目标=${selected}`, async () => {
    const h = setup({ selected }); await Promise.all([h.load(), h.show()])
    assert.equal(h.categoryCalls(), 1)
    assert.deepEqual(h.calls.map(x => x.id), [selected === '4' ? '4' : '0'])
    assert.equal(h.page.cateLevel[0]._id, selected === '4' ? '4-1' : '0-1')
  })
}
test('旧名称目标仍可解析，初始化失败后目标不丢失', async () => {
  const h = setup({ getCategories: n => { if (n === 1) throw new Error('offline'); return [{cate_id:0,name:'牛肉类'},{cate_id:4,name:'猪肉类'}] } })
  h.storage.set('selectedCategory', '猪肉'); await h.load()
  assert.equal(h.calls.length, 0); assert(h.page.categoryError)
  assert.equal(h.storage.get('selectedCategory'), '猪肉')
  await h.page.getCateList(); assert.deepEqual(h.calls.map(x => x.id), ['4'])
})
test('分类成功但为空时普通返回不会反复请求', async () => {
  const h=setup({categories:[]}); await Promise.all([h.load(),h.show()]); await h.show()
  assert.equal(h.categoryCalls(),1); assert.equal(h.calls.length,0)
})
test('初始化期间首页目标改变，以分类返回时的目标为准', async () => {
  const gate=deferred(),h=setup({selected:0,getCategories:()=>gate.promise})
  const loading=h.load(); h.storage.set('selectedCategoryId',4); const showing=h.show()
  gate.resolve([{cate_id:0,name:'A'},{cate_id:4,name:'B'}]); await Promise.all([loading,showing])
  assert.deepEqual(h.calls.map(x=>x.id),['4'])
})
test('已加载分类和空菜品分类的重复点击均不请求', async () => {
  const h=setup({getFoods:()=>({list:[],hasMore:false})}); await h.load()
  await h.page.activeChanged(0); await h.show(); assert.equal(h.calls.length,1)
})
test('同一分类第一页正在加载，连点复用一次请求', async () => {
  const gate=deferred(),h=setup({getFoods:()=>gate.promise});const loading=h.load();await tick()
  const a=h.page.activeChanged(0),b=h.page.activeChanged(0)
  assert.equal(h.calls.length,1); gate.resolve(rows('0'));await Promise.all([loading,a,b])
})
test('首次菜品失败后点同分类可重试，成功后普通点击去重', async () => {
  const h=setup({getFoods:(id,o,n)=>{if(n===1)throw new Error('offline');return rows(id)}})
  await h.load();assert(h.page.foodError);await h.page.activeChanged(0)
  assert.equal(h.calls.length,2);assert.equal(h.page.cateLevel[0]._id,'0-1')
  await h.page.activeChanged(0);assert.equal(h.calls.length,2)
})
test('刷新标记与首页新目标合并，只请求新目标', async () => {
  const h=setup();await h.load();h.calls.length=0
  h.storage.set('needRefreshFoods',1);h.storage.set('selectedCategoryId',4)
  await h.show();assert.deepEqual(h.calls.map(x=>x.id),['4'])
})
test('恢复刷新与新目标合并，失败后普通返回仍会重试', async () => {
  let fail=false
  const h=setup({getFoods:id=>{if(fail)throw new Error('offline');return rows(id)}})
  await h.load();h.calls.length=0;h.resume.seq=1;h.resume.shouldRefresh=true
  h.storage.set('selectedCategoryId',4);fail=true;await h.show()
  fail=false;await h.show();assert.deepEqual(h.calls.map(x=>x.id),['4','4'])
  await h.show();assert.equal(h.calls.length,2)
})
test('修改刷新失败保留旧内容，但下一次点击仍刷新', async () => {
  let fail=false
  const h=setup({getFoods:id=>{if(fail)throw new Error('offline');return rows(id)}})
  await h.load();h.storage.set('needRefreshFoods',1);fail=true;await h.show()
  assert.equal(h.page.cateLevel[0]._id,'0-1');fail=false;await h.page.activeChanged(0)
  assert.equal(h.calls.length,3)
})
test('快速 A→B→A 时迟到的 B 不覆盖 A', async () => {
  const b=deferred(),a=deferred()
  const h=setup({getFoods:(id,o,n)=>n===1?rows(id):(id==='4'?b.promise:a.promise)})
  await h.load();const toB=h.page.activeChanged(1);const toA=h.page.activeChanged(0)
  a.resolve(rows('A-final'));await toA;b.resolve(rows('B-late'));await toB
  assert.equal(h.page.active,0);assert.equal(h.page.cateLevel[0]._id,'A-final-1')
  assert.equal(h.page.loadingFoods,false)
})
test('先请求 A 未返回就 B→A，旧 A 也不能覆盖最后的 A', async () => {
  const gates=[deferred(),deferred(),deferred()]
  const h=setup({getFoods:(id,o,n)=>gates[n-1].promise})
  const first=h.load();await tick();const toB=h.page.activeChanged(1),toA=h.page.activeChanged(0)
  gates[0].resolve(rows('old-A'));await first;assert.equal(h.page.cateLevel.length,0)
  gates[2].resolve(rows('new-A'));await toA;gates[1].resolve(rows('B'));await toB
  assert.equal(h.page.cateLevel[0]._id,'new-A-1')
})
test('固定 pageSize=30 顺序翻页，连点续页只请求一次', async () => {
  const gate=deferred(),h=setup({getFoods:(id,o)=>o.page===1?rows(id,1,true):gate.promise})
  await h.load();const more=h.page.loadMoreFoods();await h.page.loadMoreFoods()
  assert.equal(h.calls.length,2);await h.page.activeChanged(0);assert.equal(h.calls.length,2)
  gate.resolve(rows('0',2,false));await more
  assert.deepEqual(h.calls.map(x=>[x.page,x.pageSize]),[[1,30],[2,30]])
  assert.equal(h.page.cateLevel.length,2);await h.page.loadMoreFoods();assert.equal(h.calls.length,2)
})
test('续页中切分类，不追加旧分类数据且新分类从第一页开始', async () => {
  const gate=deferred(),h=setup({getFoods:(id,o)=>o.page===2?gate.promise:rows(id,1,true)})
  await h.load();const more=h.page.loadMoreFoods();await h.page.activeChanged(1)
  gate.resolve(rows('old',2));await more
  assert.equal(h.page.foodPage,1);assert.equal(h.page.cateLevel.length,1)
  assert.equal(h.page.cateLevel[0]._id,'4-1')
})
test('续页失败不前进页码，可再次请求同一页', async () => {
  const h=setup({getFoods:(id,o,n)=>{if(n===2)throw new Error('offline');return rows(id,o.page,o.page===1)}})
  await h.load();await h.page.loadMoreFoods();assert.equal(h.page.foodPage,1)
  await h.page.loadMoreFoods();assert.deepEqual(h.calls.map(x=>x.page),[1,2,2])
})
test('较新修改标记到达时旧请求不能完成本次刷新', async () => {
  const old=deferred(),fresh=deferred()
  const h=setup({getFoods:(id,o,n)=>n===1?rows(id):n===2?old.promise:fresh.promise})
  await h.load();h.storage.set('needRefreshFoods',1);const first=h.show();await tick()
  h.storage.set('needRefreshFoods',1);const second=h.show();await tick()
  old.resolve(rows('stale'));await first;assert.equal(h.page.cateLevel[0]._id,'0-1')
  fresh.resolve(rows('fresh'));await second;assert.equal(h.page.cateLevel[0]._id,'fresh-1')
  await h.page.activeChanged(0);assert.equal(h.calls.length,3)
})
test('卸载后迟到结果不更新页面', async () => {
  const gate=deferred(),h=setup({getFoods:()=>gate.promise});const loading=h.load();await tick()
  h.unload();gate.resolve(rows('late'));await loading;assert.equal(h.page.cateLevel.length,0)
})
