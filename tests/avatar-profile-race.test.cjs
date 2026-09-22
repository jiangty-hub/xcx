const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const path = require('node:path')
const cloudDir = path.join(__dirname, '../uniCloud-alipay/cloudfunctions/update-user-profile')
const helpers = require(path.join(cloudDir, 'avatar-files.js'))
const { saveProfileSafely, excludeReferencedAvatars } = helpers
const host = 'https://env-00jy6ttlqgid.normal.cloudstatic.cn'
const avatar = host + '/avatar/u1/new.jpg'
const oldAvatar = host + '/avatar/u1/old.jpg'
const storage = require(path.join(cloudDir, 'storage-files.js'))
const stateKey = createHash('sha256').update(storage.fileID(avatar)).digest('hex')
const clone = value => value === undefined ? undefined : structuredClone(value)
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return {promise, resolve} }

// 内存 MVCC 替身：读取快照、提交检查冲突、原子发布写入。
// 仅验证控制流/交错，不替代支付宝云真实事务集成测试。
class Database {
  constructor() { this.rows = new Map(); this.versions = new Map(); this.nextCommit = null }
  put(collection, id, value) { const key=collection+'/'+id; this.rows.set(key,clone(value));this.versions.set(key,(this.versions.get(key)||0)+1) }
  get(collection,id) { return clone(this.rows.get(collection+'/'+id)) }
  command = { in: values => ({ values }) }
  collection(collection) {
    const db=this
    return {
      doc(id) { return { field(){return this}, get:async()=>({data:db.get(collection,id)?[db.get(collection,id)]:[]}) } },
      where(condition) { return {limit(){return this},get:async()=>({data:[...db.rows.entries()].filter(([key,row])=>key.startsWith(collection+'/') && Object.entries(condition).every(([field,value])=>value?.values?(Array.isArray(row[field])?row[field].some(x=>value.values.includes(x)):value.values.includes(row[field])):row[field]===value)).map(([,row])=>clone(row))})} },
      async add(row) { db.put(collection, row._id || String(db.rows.size),row) }
    }
  }
  async startTransaction() {
    const db=this, snapshot=clone(this.rows), versions=clone(this.versions), read=new Set(), writes=new Map()
    const hook=this.nextCommit;this.nextCommit=null
    return {
      collection(name) { return {
        doc(id) { const key=name+'/'+id;return {
          async get(){read.add(key);const row=snapshot.get(key);return {data:row?[clone(row)]:[]}},
          async update(data){read.add(key);const old=writes.get(key)||snapshot.get(key);if(!old)return {updated:0};const unchanged=Object.keys(data).every(k=>old[k]===data[k]);writes.set(key,{...clone(old),...clone(data)});return {updated:unchanged?0:1}}
        } },
        async add(data){const key=name+'/'+data._id;read.add(key);if(snapshot.has(key))throw new Error('duplicate');writes.set(key,clone(data));return {id:data._id}}
      } },
      async commit(){if(hook)await hook();for(const key of read){if((versions.get(key)||0)!==(db.versions.get(key)||0))throw new Error('transaction conflict')};for(const [key,row] of writes){db.rows.set(key,clone(row));db.versions.set(key,(db.versions.get(key)||0)+1)}},
      async rollback(){}
    }
  }
}
function database(current='') { const db=new Database();db.put('uni-id-users','u1',{avatar:current,nickname:'before'});return db }

test('同一头像切换 HTTPS/cloud 形式仍被保护',async()=>{
  for(const [current,candidate] of [[avatar,storage.fileID(avatar)],[storage.fileID(avatar),avatar]]) {
    const db=database(current)
    assert.deepEqual((await excludeReferencedAvatars(db,[candidate])).referenced,[candidate])
  }
})

test('旧 HTTPS 和迁移前阿里云地址的 deleting 状态仍阻止新形式保存',async()=>{
  for(const alias of storage.aliases(avatar)) {
    const db=database(oldAvatar),key=createHash('sha256').update(alias).digest('hex')
    db.put('avatar_file_states',key,{fileID:alias,status:'deleting',revision:1})
    await assert.rejects(saveProfileSafely(db,'u1',{avatar:storage.fileID(avatar)}),{code:409})
    assert.equal(db.get('uni-id-users','u1').avatar,oldAvatar)
  }
})

test('旧 active 状态按统一 ID 保存，保留旧记录',async()=>{
  const db=database(),key=createHash('sha256').update(avatar).digest('hex')
  db.put('avatar_file_states',key,{fileID:avatar,status:'active',revision:4})
  await saveProfileSafely(db,'u1',{avatar})
  assert.equal(db.get('avatar_file_states',stateKey).fileID,storage.fileID(avatar))
  assert.equal(db.get('avatar_file_states',key).revision,4)
})

test('跨地址形式并发：清理先提交，保存事务冲突，且以后保存被拒绝',async()=>{
  const db=database(oldAvatar),entered=deferred(),release=deferred()
  db.nextCommit=async()=>{entered.resolve();await release.promise}
  const saving=saveProfileSafely(db,'u1',{avatar}),rejection=assert.rejects(saving,/transaction conflict/)
  await entered.promise
  assert.deepEqual((await excludeReferencedAvatars(db,[storage.fileID(avatar)])).deletable,[storage.fileID(avatar)])
  release.resolve();await rejection
  await assert.rejects(saveProfileSafely(db,'u1',{avatar}),{code:409})
})

test('跨地址形式并发：保存先提交，清理事务冲突',async()=>{
  const db=database(),entered=deferred(),release=deferred()
  db.nextCommit=async()=>{entered.resolve();await release.promise}
  const cleaning=excludeReferencedAvatars(db,[avatar]),rejection=assert.rejects(cleaning,/transaction conflict/)
  await entered.promise
  await saveProfileSafely(db,'u1',{avatar:storage.fileID(avatar)})
  release.resolve();await rejection
  assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).referenced,[avatar])
})

test('保存先提交：当前头像被保护，清理列表为空',async()=>{
  const db=database();await saveProfileSafely(db,'u1',{avatar,nickname:'after'})
  const result=await excludeReferencedAvatars(db,[avatar]);assert.deepEqual(result,{referenced:[avatar],deletable:[]})
  assert.equal(db.get('uni-id-users','u1').avatar,avatar)
})
test('清理先提交：迟到保存明确拒绝，昵称也不部分写入',async()=>{
  const db=database(oldAvatar);assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).deletable,[avatar])
  await assert.rejects(saveProfileSafely(db,'u1',{avatar,nickname:'after'}),{code:409})
  assert.deepEqual(db.get('uni-id-users','u1'),{avatar:oldAvatar,nickname:'before'})
})
test('保存事务已读取但暂停：清理提交后，旧保存事务冲突回滚',async()=>{
  const db=database(oldAvatar),entered=deferred(),release=deferred()
  db.nextCommit=async()=>{entered.resolve();await release.promise}
  const saving=saveProfileSafely(db,'u1',{avatar});const rejection=assert.rejects(saving,/transaction conflict/)
  await entered.promise;assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).deletable,[avatar]);release.resolve();await rejection
  assert.equal(db.get('uni-id-users','u1').avatar,oldAvatar)
})
test('清理事务已读取但暂停：保存提交后，旧清理事务冲突且不返回可删文件',async()=>{
  const db=database(),entered=deferred(),release=deferred()
  db.nextCommit=async()=>{entered.resolve();await release.promise}
  const cleaning=excludeReferencedAvatars(db,[avatar]);const rejection=assert.rejects(cleaning,/transaction conflict/)
  await entered.promise;await saveProfileSafely(db,'u1',{avatar});release.resolve();await rejection
  assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).referenced,[avatar])
})
test('物理删除失败也不撤销标记；定时重试可再次认领',async()=>{
  const db=database();await excludeReferencedAvatars(db,[avatar])
  assert.equal(db.get('avatar_file_states',stateKey).status,'deleting')
  await assert.rejects(saveProfileSafely(db,'u1',{avatar}),{code:409})
  assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).deletable,[avatar])
})
test('历史当前头像无需状态迁移；仅修改昵称和清空头像可用',async()=>{
  const legacy=host+'/cloudstorage/legacy.jpg',db=database(legacy)
  await saveProfileSafely(db,'u1',{nickname:'new'});assert.equal(db.get('uni-id-users','u1').avatar,legacy)
  await saveProfileSafely(db,'u1',{avatar:legacy});await saveProfileSafely(db,'u1',{avatar:''})
  assert.equal(db.get('uni-id-users','u1').avatar,'')
})
test('拒绝把他人头像或非归属地址作为新头像写入',async()=>{
  const db=database();await assert.rejects(saveProfileSafely(db,'u1',{avatar:host+'/avatar/u2/a.jpg'}),{code:400})
  assert.equal(db.get('uni-id-users','u1').avatar,'')
})
test('保留其他用户和菜品的已存在引用',async()=>{
  for(const [collection,row] of [['uni-id-users',{avatar}],['foods',{cover_images:[avatar]}],['foods',{images:[avatar]}]]){
    const db=database();db.put(collection,'other',row)
    assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).referenced,[avatar])
    assert.equal(db.get('avatar_file_states',stateKey),undefined)
  }
})
test('已有 active 状态也通过写 revision 与清理互斥',async()=>{
  const db=database();await saveProfileSafely(db,'u1',{avatar});await saveProfileSafely(db,'u1',{avatar:''})
  await excludeReferencedAvatars(db,[avatar]);await assert.rejects(saveProfileSafely(db,'u1',{avatar}),{code:409})
})
function endpoint(db,deleted){
  const ctx={exports:{},console,require:name=>name==='uni-id-common'?{createInstance:()=>({checkToken:async()=>({uid:'u1'})})}:name==='./avatar-files'?helpers:name==='./storage-files'?storage:require(name),uniCloud:{database:()=>db,deleteFile:async({fileList})=>{deleted.push(...fileList);return {fileList:fileList.map(fileID=>({fileID}))}}}}
  vm.runInNewContext(fs.readFileSync(path.join(cloudDir,'index.js'),'utf8'),ctx);return ctx.exports.main
}
test('真实云函数入口：模拟保存挂起、清理抢先，不会成功写入被删文件',async()=>{
  const db=database(oldAvatar),deleted=[],call=endpoint(db,deleted),entered=deferred(),release=deferred()
  db.nextCommit=async()=>{entered.resolve();await release.promise}
  const saving=call({token:'test',avatar,nickname:'after'},{});const rejection=assert.rejects(saving,/transaction conflict/)
  await entered.promise;const result=await call({token:'test',cleanupAvatarFileIds:[avatar]},{});assert.equal(result.code,0)
  release.resolve();await rejection;assert(deleted.includes(storage.fileID(avatar)));assert.equal(db.get('uni-id-users','u1').avatar,oldAvatar)
  assert.equal((await call({token:'test',avatar,nickname:'after'},{})).code,409)
})
test('缺少用户不能报告保存成功',async()=>{
  await assert.rejects(saveProfileSafely(new Database(),'u1',{avatar}),{code:404})
})
test('重复保存相同资料：update 返回 0 仍正常成功',async()=>{
  const db=database(avatar);await saveProfileSafely(db,'u1',{avatar,nickname:'before'})
  await saveProfileSafely(db,'u1',{nickname:'before'})
  assert.equal(db.get('uni-id-users','u1').avatar,avatar)
})
test('事务 doc.get 返回单对象时仍正确识别当前头像',async()=>{
  const db=database(),original=db.startTransaction.bind(db)
  db.startTransaction=async()=>{
    const tx=await original(),collection=tx.collection.bind(tx)
    tx.collection=name=>{const c=collection(name),doc=c.doc.bind(c);c.doc=id=>{const d=doc(id),get=d.get.bind(d);d.get=async()=>({data:(await get()).data[0]});return d};return c}
    return tx
  }
  await saveProfileSafely(db,'u1',{avatar});assert.equal(db.get('uni-id-users','u1').avatar,avatar)
  await saveProfileSafely(db,'u1',{avatar:''});assert.deepEqual((await excludeReferencedAvatars(db,[avatar])).deletable,[avatar])
})
