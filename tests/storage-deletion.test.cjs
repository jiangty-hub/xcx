const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.join(__dirname, '../uniCloud-alipay/cloudfunctions')
const storage = require(path.join(root, 'food-service/storage-files'))
const host = 'https://env-00jy6ttlqgid.normal.cloudstatic.cn'
const cloud = 'cloud://env-00jy6ttlqgid'
const a = host + '/foods/a.jpg', b = host + '/foods/b.jpg'

test('归属检查拒绝其他空间、签名、凭证、转义和非图片业务目录', async () => {
  const invalid = ['https://other/foods/a.jpg','cloud://other/foods/a.jpg', a+'?token=x', a+'#x',
    host.replace('://','://u:p@')+'/foods/a.jpg', host+'/foods/%2fother.jpg', host+'/foods/../a.jpg',
    host+'/foods/', host+'/foods//a.jpg', 'https://mp-e3a48079-7f55-4c65-8f6c-9d757e567f86.cdn.bspapp.com/foods/a.jpg']
  for (const value of invalid) assert.equal(storage.fileID(value), '', value)
  for (const p of ['/foods/a.jpg','/cloudstorage/a.jpg']) {
    assert.equal(storage.isFoodCoverFile(host+p), true)
    assert.equal(storage.isFoodCoverFile(cloud+p), true)
  }
  assert.equal(storage.isOwnedAvatarFile(cloud+'/avatar/u2/a.jpg','u1'), false)
  let calls=0
  const result=await storage.deleteFiles({deleteFile:async()=>{calls++}},[...invalid,host+'/banner/a.jpg'])
  assert.equal(calls,0)
  assert.equal(result.failedFileIDs.length,invalid.length+1)
})

test('转换并去重，只发 cloud ID，回执保留调用者原地址',async()=>{
  let sent
  const result=await storage.deleteFiles({deleteFile:async({fileList})=>{sent=fileList;return {requestId:'r1',fileList:fileList.map(fileID=>({fileID}))}}},[a,storage.fileID(a),a])
  assert.deepEqual(sent,[cloud+'/foods/a.jpg'])
  assert.equal(result.deleted,1)
  assert.deepEqual(result.deletedFileIDs,[a,storage.fileID(a)])
  assert.deepEqual(result.failedFileIDs,[])
  assert.equal(result.requestId,'r1')
})

test('部分失败、缺失、重复结果不误报整批成功',async()=>{
  for (const failedRows of [[{fileID:storage.fileID(b),code:500}],[],[{fileID:storage.fileID(b)},{fileID:storage.fileID(b)}]]) {
    const result=await storage.deleteFiles({deleteFile:async()=>({fileList:[{fileID:storage.fileID(a),code:0},...failedRows]})},[a,b])
    assert.deepEqual(result.deletedFileIDs,[a])
    assert.deepEqual(result.failedFileIDs,[b])
    assert(result.error)
  }
})

test('异常和无法确认的返回值保留待重试；不把未知错误猜成文件不存在',async()=>{
  for (const response of [undefined,{}, {requestId:'x'}, {code:500,fileList:[{fileID:storage.fileID(a)}]}, {fileList:[{fileID:storage.fileID(a),status:'NOT_FOUND'}]}]) {
    const r=await storage.deleteFiles({deleteFile:async()=>response},[a])
    assert.deepEqual(r.failedFileIDs,[a]);assert.equal(r.deleted,0);assert(r.error)
  }
  const r=await storage.deleteFiles({deleteFile:async()=>{throw Error('timeout')}},[a])
  assert.deepEqual(r.failedFileIDs,[a]);assert.match(r.error,/timeout/)
})

test('分批删除，后一批失败不丢失前一批成功结果',async()=>{
  const values=Array.from({length:51},(_,i)=>host+'/foods/'+i+'.jpg');let calls=0
  const r=await storage.deleteFiles({deleteFile:async({fileList})=>{calls++;assert(fileList.length<=50);if(calls===2)throw Error('offline');return {fileList:fileList.map(fileID=>({fileID}))}}},values)
  assert.equal(r.deleted,50);assert.deepEqual(r.failedFileIDs,[values[50]])
})

function referenceDB(rows) {
  return {command:{in:values=>({values})},collection: name=>({where:condition=>({limit(){return this},async get(){
    return {data:(rows[name]||[]).filter(row=>Object.entries(condition).every(([k,v])=>(Array.isArray(row[k])?row[k]:[row[k]]).some(x=>v.values.includes(x))))}
  }})})}
}
test('跨地址形式识别菜品、历史 images、头像和迁移前引用',async()=>{
  for (const [collection,field] of [['foods','cover_images'],['foods','images'],['uni-id-users','avatar']]) {
    for (const alias of storage.aliases(a)) {
      const value=field==='avatar'?alias:[alias]
      const r=await storage.excludeReferencedFoodCovers(referenceDB({[collection]:[{[field]:value}]}),[a,storage.fileID(a),b])
      assert.deepEqual(r.referenced,[a,storage.fileID(a)])
      assert.deepEqual(r.deletable,[b])
    }
  }
})
test('引用查询失败时停止删除',async()=>{
  await assert.rejects(storage.excludeReferencedFoodCovers({command:{in:x=>x},collection:()=>({where(){return this},limit(){return this},get:async()=>({})})},[a]),/未确认/)
})

function loadEntry(relative, db, deleteFile) {
  const filename=path.join(root,relative),localRequire=createRequire(filename),module={exports:{}}
  const context={module,exports:module.exports,console,require:n=>n==='uni-id-common'?{}:localRequire(n),uniCloud:{database:()=>db,deleteFile}}
  const append=relative.startsWith('food-service')?'\nmodule.exports.testDelete = deleteCoverFiles':''
  vm.runInNewContext(fs.readFileSync(filename,'utf8')+append,context,{filename})
  return module.exports
}
test('菜品实际删除流程：跨形式保护引用，失败文件入队并保留原地址',async()=>{
  const db=referenceDB({foods:[{cover_images:[storage.fileID(a)]}]}),get=db.collection,queued=[]
  db.collection=n=>n==='file_cleanup_tasks'?{add:async row=>queued.push(row)}:get(n)
  let calls=0
  const entry=loadEntry('food-service/index.obj.js',db,async({fileList})=>{calls++;assert.deepEqual(fileList,[storage.fileID(b)]);throw Error('timeout')})
  const result=await entry.testDelete([a,b],'test')
  assert.equal(calls,1);assert.deepEqual(result.protectedFileIDs,[a]);assert.equal(result.queued,true)
  assert.deepEqual([...queued[0].fileIDs],[b]);assert(result.confirmedFileIDs.includes(b))
})
test('定时重试：只保留失败文件，不能把部分失败记为 done',async()=>{
  const db=referenceDB({}),get=db.collection,updates=[]
  db.collection=n=>n==='file_cleanup_tasks'?{where(){return this},orderBy(){return this},limit(){return this},get:async()=>({data:[{_id:'task',taskType:'food',fileIDs:[a,b],attempts:0}]}),doc:()=>({update:async v=>updates.push(v)})}:get(n)
  const entry=loadEntry('retry-file-cleanup/index.js',db,async()=>({fileList:[{fileID:storage.fileID(a)},{fileID:storage.fileID(b),code:500}]}))
  const result=await entry.main({}, {SOURCE:'timing'})
  assert.equal(result.completed,0);assert.equal(updates[0].status,'pending');assert.equal(updates[0].attempts,1)
  assert.deepEqual([...updates[0].fileIDs],[b])
})
test('各部署单元的存储辅助模块一致，头像辅助模块一致',()=>{
  const content=fs.readFileSync(path.join(root,'food-service/storage-files.js'),'utf8')
  for(const dir of ['update-user-profile','retry-file-cleanup'])assert.equal(fs.readFileSync(path.join(root,dir,'storage-files.js'),'utf8'),content)
  assert.equal(fs.readFileSync(path.join(root,'update-user-profile/avatar-files.js'),'utf8'),fs.readFileSync(path.join(root,'retry-file-cleanup/avatar-files.js'),'utf8'))
})
