const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function load(name) {
  const calls = { collections: 0, reads: 0, writes: 0, deletedFiles: [] }
  let logsRemoved = false
  const fileID = 'https://env-00jy6ttlqgid.normal.cloudstatic.cn/foods/test.jpg'
  const db = {
    command: { in: values => ({ values }), lt: value => ({ value }) },
    collection(collection) {
      calls.collections++
      return {
        where() { return this }, orderBy() { return this }, limit() { return this },
        field() { return this }, skip() { return this }, doc() { return this },
        async count() { calls.reads++; return { total: collection === 'uni-id-log' ? 1 : 0 } },
        async get() {
          calls.reads++
          if (name === 'retry-file-cleanup' && collection === 'file_cleanup_tasks') {
            return { data: [{ _id: 'task1', taskType: 'food', fileIDs: [fileID], attempts: 0 }] }
          }
          if (collection === 'uni-id-log' && !logsRemoved) return { data: [{ _id: 'log1' }] }
          return { data: [] }
        },
        async remove() { calls.writes++; logsRemoved = true; return { deleted: 1 } },
        async update() { calls.writes++; return { updated: 1 } }
      }
    }
  }
  const sandbox = {
    exports: {}, console,
    require(name) {
      // 本测试验证入口与原有菜品清理路径；头像事务另有独立回归测试。
      if (name === './avatar-files') return {
        isOwnedAvatarFile() { throw new Error('unexpected avatar path') },
        excludeReferencedAvatars() { throw new Error('unexpected avatar path') }
      }
      if (name === './storage-files') return require('../uniCloud-alipay/cloudfunctions/retry-file-cleanup/storage-files')
      if (name === 'url') return require('node:url')
      throw new Error('unexpected dependency: ' + name)
    },
    uniCloud: {
      database: () => db,
      async deleteFile({ fileList }) { calls.deletedFiles.push(...fileList); return {fileList:fileList.map(fileID=>({fileID}))} }
    }
  }
  const file = path.join(__dirname, '../uniCloud-alipay/cloudfunctions', name, 'index.js')
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file })
  return { main: sandbox.exports.main, calls, fileID }
}

const rejected = [
  ['client', { SOURCE: 'client' }],
  ['http', { SOURCE: 'http' }],
  ['function', { SOURCE: 'function' }],
  ['websocket', { SOURCE: 'websocket' }],
  ['unknown', { SOURCE: 'other' }],
  ['empty source', { SOURCE: '' }],
  ['missing source', {}],
  ['missing context', undefined],
  ['null context', null],
  ['incorrect type', { SOURCE: ['timing'] }],
  ['wrong case', { SOURCE: 'TIMING' }]
]

for (const name of ['clean-uniid-log', 'retry-file-cleanup']) {
  for (const [label, context] of rejected) {
    test(`${name}: rejects ${label} before database/file operations, ignoring forged event`, async () => {
      const { main, calls } = load(name)
      const result = await main({ source: 'timing', SOURCE: 'server', context: { SOURCE: 'timing' }, isAdmin: true, token: 'forged' }, context)
      assert.equal(result.code, 403)
      assert.deepEqual(calls, { collections: 0, reads: 0, writes: 0, deletedFiles: [] })
    })
  }
  for (const source of ['timing', 'server']) {
    test(`${name}: permits ${source} and preserves successful cleanup result`, async () => {
      const { main, calls, fileID } = load(name)
      const result = await main({ source: 'client' }, { SOURCE: source })
      assert(calls.reads > 0)
      assert(calls.writes > 0)
      if (name === 'clean-uniid-log') {
        assert.equal(result.ok, true)
        assert.equal(result.deleted, 1)
        assert.equal(result.keepDays, 7)
        assert.deepEqual(calls.deletedFiles, [])
      } else {
        assert.equal(result.processed, 1)
        assert.equal(result.completed, 1)
        assert.equal(result.failed, 0)
        assert.deepEqual(calls.deletedFiles, [fileID.replace('https://env-00jy6ttlqgid.normal.cloudstatic.cn', 'cloud://env-00jy6ttlqgid')])
      }
    })
  }
}
