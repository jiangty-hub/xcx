const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
 const calls=[],events=[],queued=[],timers=[];
 const env={module:{exports:{}},console:{error(){},warn(){}},leaveGuard:{},setTimeout:f=>timers.push(f),beginLoading:()=>async()=>{},applyNewToken(){},clearAuthStorage(){},getAuthToken:()=> 'token',isAuthExpiredResult:r=>r.code===401,resolveCloudFileToUrl:async v=>v,
 addPendingCleanup:(type,ids)=>queued.push(...ids),getPendingCleanup:()=>[],removePendingCleanup(){},
 uni:{getStorageSync:()=> 'uid',setStorageSync(){},removeStorageSync(){},showToast:o=>events.push(o.title),chooseImage:o=>o.success({tempFilePaths:['/tmp/new.jpg']})},
 uniCloud:{callFunction:async o=>{calls.push(o);return {result:{code:0,cleanup:{confirmedFileIDs:[]}}}},uploadFile:async()=>({fileID:'cloud://new'}),getTempFileURL:async()=>({fileList:[{tempFileURL:'https://new'}]})}};
 const source=fs.readFileSync(path.join(__dirname,'../pages/profile/edit.vue'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?\r?$/gm,'').replace('export default','module.exports =');vm.runInNewContext(source,env);const def=env.module.exports;
 const p={...def.data(),...def.methods,leaveGuardLeaving:false,preparePageLeave:async()=>events.push('prepare'),leavePageWithoutAlert:()=>events.push('leave'),getOpenerEventChannel:()=>({emit:e=>events.push(e)})};
 for(const [k,get]of Object.entries(def.computed))Object.defineProperty(p,k,{get:()=>get.call(p)});
 p.profileReady=true;p.nickname='昵称';p.avatarPreview='https://old';p.avatarFileId='cloud://old';p.avatarCleanupType='avatar:uid';
 return {p,env,def,calls,events,queued,timers};
}
for(const kind of ['keep','replace','clear'])test('save avatar semantics: '+kind,async()=>{
 const {p,calls,events}=setup();if(kind==='replace'){p.avatarChanged=true;p.avatarFileId='cloud://new'}if(kind==='clear'){p.clearAvatar();assert.equal(calls.length,0)}
 await p.save();const data=calls[0].data;if(kind==='keep')assert.equal(Object.hasOwn(data,'avatar'),false);else assert.equal(data.avatar,kind==='clear'?'':'cloud://new');assert(events.includes('profileUpdated'));assert.equal(p.avatarChanged,false);
});
test('display failure recovery never mutates avatar identity',()=>{const {p,def}=setup();p.avatarFailed=true;def.watch.avatarPreview.call(p);assert.equal(p.avatarFailed,false);assert.equal(p.avatarFileId,'cloud://old');assert.equal(p.avatarChanged,false)});
test('late picker callback after leaving does not upload',async()=>{const {p,env}=setup();let pick,uploads=0;env.uni.chooseImage=o=>pick=o;env.uniCloud.uploadFile=async()=>{uploads++;return {fileID:'late'}};const task=p.chooseAvatar();p.pageDisposed=true;pick.success({tempFilePaths:['/tmp/new.jpg']});await task;assert.equal(uploads,0);assert.equal(p.avatarPreview,'https://old')});
test('late upload stays in persistent cleanup queue without toast or URL request',async()=>{const {p,env,queued,events}=setup();let resolveUpload;const started=new Promise(resolve=>{env.uniCloud.uploadFile=()=>{resolve();return new Promise(r=>resolveUpload=r)}});let urls=0;env.uniCloud.getTempFileURL=async()=>{urls++;return {fileList:[]}};const task=p.chooseAvatar();await started;p.pageDisposed=true;resolveUpload({fileID:'cloud://late'});await task;assert.deepEqual(queued,['cloud://late']);assert.equal(urls,0);assert.equal(events.length,0);assert.equal(p.avatarUploading,false)});
test('failed save retains draft and does not notify parent or leave',async()=>{const {p,env,events}=setup();p.avatarChanged=true;p.nicknameEdited=true;env.uniCloud.callFunction=async()=>{throw Error('offline')};await p.save();assert.equal(p.avatarChanged,true);assert.equal(p.nicknameEdited,true);assert.deepEqual(events,['offline']);assert.equal(p.saving,false)});
test('initialization and upload disable all editing',()=>{const {p}=setup();p.profileReady=false;assert.equal(p.formDisabled,true);p.profileReady=true;p.avatarUploading=true;assert.equal(p.formDisabled,true);p.avatarUploading=false;assert.equal(p.formDisabled,false)});
