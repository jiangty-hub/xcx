const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../subpkg/search/search.vue'),'utf8');
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'').replace('export default','module.exports =');
const tick=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function setup(service=async()=>({list:[],hasMore:false})){
  const timers=new Map(),calls=[],storage=new Map(),toasts=[],navigation=[];
  let timerId=0;
  const resume={seq:0,shouldRefresh:false};
  const env={module:{exports:{}},HomePicture:{},console:{error(){}},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},
    getResumeRefreshState:()=>resume,
    uniCloud:{importObject:()=>({searchFoods:async(k,o)=>{calls.push({k,...o});return service(k,o,calls.length)}})},
    uni:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),showToast:x=>toasts.push(x),hideKeyboard(){},navigateTo:x=>navigation.push(x)}
  };
  vm.runInNewContext(script,env);const d=env.module.exports;
  const p=Object.assign(d.data(),d.methods);d.created.call(p);
  return {p,d,timers,calls,storage,resume,toasts,navigation,async flush(){const jobs=[...timers.values()];timers.clear();jobs.forEach(x=>x.fn());await tick()},show:()=>d.onShow.call(p),unload:()=>d.onUnload.call(p)};
}
test('400ms 防抖立即隐藏旧结果，只有最终关键词发请求',async()=>{
  const h=setup();h.p.searchResults=[{_id:'old'}];h.p.onInput('牛');h.p.onInput('牛肉');
  assert.equal(h.p.searchResults.length,0);assert.equal(h.p.pendingSearch,true);assert.equal(h.timers.size,1);assert.equal([...h.timers.values()][0].ms,400);
  await h.p.loadMoreResults();assert.equal(h.calls.length,0);
  await h.flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].k,'牛肉');assert.equal(h.p.pendingSearch,false);
});
test('键盘确认取消防抖，同一在途关键词不会重复请求',async()=>{
  const job=deferred(),h=setup(()=>job.promise);h.p.onInput('牛肉');
  const first=h.p.onConfirm({detail:{value:'牛肉'}});h.p.onConfirm({detail:{value:'牛肉'}});
  assert.equal(h.timers.size,0);assert.equal(h.calls.length,1);job.resolve({list:[],hasMore:false});await first;await h.flush();assert.equal(h.calls.length,1);
});
test('迟到的旧关键词结果不覆盖新词',async()=>{
  const a=deferred(),b=deferred(),h=setup(k=>k==='A'?a.promise:b.promise);
  const pa=h.p.submitSearch('A');h.p.onInput('B');await h.flush();
  b.resolve({list:[{_id:'B'}],hasMore:false});await tick();a.resolve({list:[{_id:'A'}],hasMore:true});await pa;
  assert.equal(h.p.searchResults[0]._id,'B');assert.equal(h.p.loading,false);assert.equal(h.p.searchHasMore,false);
});
test('清空或纯空格输入后旧请求不能恢复列表',async()=>{
  const job=deferred(),h=setup(()=>job.promise);const p=h.p.submitSearch('牛肉');h.p.onInput('   ');job.resolve({list:[{_id:'old'}],hasMore:true});await p;
  assert.equal(h.p.searchResults.length,0);assert.equal(h.p.hasSearched,false);assert.equal(h.p.pendingSearch,false);assert.equal(h.p.searchHasMore,false);
});
test('超长旧历史明确报错，不截词、不访问云端；50 字可查询',async()=>{
  const h=setup();await h.p.gotoHistory('牛'.repeat(51));assert.equal(h.calls.length,0);assert.match(h.p.searchError,/50/);assert.equal(h.p.kw.length,51);
  await h.p.submitSearch('牛'.repeat(50));assert.equal(h.calls.length,1);
});
test('历史兼容缓存、去重与 20 条上限，清空只操作历史',async()=>{
  const h=setup();h.storage.set('kw',JSON.stringify(['牛肉','',null,'牛肉',' 羊肉 ']));await h.show();assert.equal(h.p.historyList.join(','),'牛肉,羊肉');
  for(let i=0;i<22;i++)h.p.saveHistory('菜'+i);h.p.saveHistory('菜5');assert.equal(h.p.historyList.length,20);assert.equal(h.p.historyList.at(-1),'菜5');
  h.p.kw='牛肉';h.p.clean();assert.equal(h.storage.get('kw'),'[]');assert.equal(h.p.kw,'牛肉');
  h.storage.set('kw','{bad');await h.show();assert.equal(h.p.historyList.length,0);assert.equal(h.storage.has('kw'),false);
});
test('零结果记历史，首次失败不记历史，重试取消残留定时器',async()=>{
  const h=setup((k,o,n)=>{if(n===2)throw Error('网络失败');return {list:[],hasMore:false}});
  await h.p.submitSearch('空结果');assert.equal(h.p.hasSearched,true);assert.equal(h.p.historyList[0],'空结果');
  await h.p.submitSearch('失败词');assert.match(h.p.searchError,/网络/);assert.equal(h.p.historyList.includes('失败词'),false);
  h.p.onInput('重试词');await h.p.retrySearch();assert.equal(h.timers.size,0);assert.equal(h.calls.length,3);
});
test('分页防连点、去重，失败保留旧结果与页码并可重试',async()=>{
  const next=deferred();const h=setup((k,o,n)=>n===1?{list:[{_id:'1'}],hasMore:true}:n===2?next.promise:{list:[{_id:'1'},{_id:'2'}],hasMore:false});
  await h.p.submitSearch('菜');const more=h.p.loadMoreResults();await h.p.loadMoreResults();assert.equal(h.calls.length,2);
  next.reject(Error('续页失败'));await more;assert.equal(h.p.searchPage,1);assert.equal(h.p.searchResults.length,1);assert.equal(h.toasts.length,1);
  await h.p.loadMoreResults();assert.equal(h.p.searchPage,2);assert.equal(h.p.searchResults.map(x=>x._id).join(','),'1,2');assert.equal(h.calls[2].pageSize,30);
});
test('详情返回与恢复合并刷新，不消费分类页标记',async()=>{
  const h=setup();await h.p.submitSearch('菜');h.p.gotoDetail({_id:'abc'});assert.match(h.navigation[0].url,/id=abc/);
  h.storage.set('needRefreshFoods',1);h.resume.shouldRefresh=true;h.resume.seq=2;await h.show();assert.equal(h.calls.length,2);assert.equal(h.storage.get('needRefreshFoods'),1);
});
test('卸载清理计时器并使在途结果失效',async()=>{
  const job=deferred(),h=setup(()=>job.promise);const p=h.p.submitSearch('菜');h.unload();job.resolve({list:[{_id:'late'}],hasMore:true});await p;assert.equal(h.p.searchResults.length,0);
  const h2=setup();h2.p.onInput('菜');h2.unload();await h2.flush();assert.equal(h2.calls.length,0);
});
