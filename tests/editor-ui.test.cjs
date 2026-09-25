const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(service={}) {
  const events=[],storage=new Map(),listeners=[];
  const env={module:{exports:{}},console:{error(){},warn(){}},process:{env:{UNI_PLATFORM:'mp-weixin'}},leaveGuard:{},setTimeout(){},setInterval(){return 1},clearInterval(){},
    beginLoading:()=>async()=>{},applyNewToken(){},getAuthToken:()=> 'token',checkManagePermission:async()=>({canManage:true}),
    getPendingCleanup:()=>[],addPendingCleanup(){},removePendingCleanup(){},getProtectedCreateCovers:()=>[],getProtectedEditCovers:()=>[],
    getFoodCreateRequest:()=>null,getFoodEditRequest:()=>null,
    saveFoodCreateRequest:(uid,r)=>storage.set('create',r),saveFoodEditRequest:(uid,id,r)=>storage.set('edit',r),clearFoodCreateRequest(){},clearFoodEditRequest(){},newFoodCreateId:()=> 'fc_request_fixed_123456789',
    uniCloud:{importObject:()=>service,getTempFileURL:async()=>({fileList:[]})},
    uni:{getStorageSync:()=> 'uid',setStorageSync(){},hideKeyboard(){},showToast:o=>events.push(o.title),showModal:o=>events.push(o),onKeyboardHeightChange:f=>listeners.push(f),offKeyboardHeightChange:f=>listeners.splice(listeners.indexOf(f),1),chooseMedia:async()=>{throw {errMsg:'chooseMedia:fail cancel'}}}};
  const script=fs.readFileSync(path.join(__dirname,'../pages/addDish/addDish.vue'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm,'').replace('export default','module.exports =');
  vm.runInNewContext(script,env);const def=env.module.exports;
  const page={...def.data(),leaveGuardLeaving:false,...def.methods,preparePageLeave:async()=>{},leavePageWithoutAlert:async()=>{events.push('left')}};
  for(const [key,get] of Object.entries(def.computed))Object.defineProperty(page,key,{get:()=>get.call(page)});
  page.createInitializing=false;page.canManage=true;page.createOwnerUid='uid';page.form.name='测试菜';page.form.categoryId='1';page.cateList=[{cate_id:'1',name:'牛肉类'}];page.snapshot=JSON.stringify(page.normalizeForm(page.form));
  return {page,env,def,events,storage,listeners};
}
test('zero numeric values pass; nonfinite, obsolete category and long fields fail',()=>{
 const {page:p}=setup();assert.equal(p.validate(),'');p.form.price=Infinity;assert.equal(p.validate(),'价格不合法');p.form.price=0;p.form.cook_time=NaN;assert.equal(p.validate(),'时长不合法');p.form.cook_time=0;p.form.name='菜'.repeat(51);assert.match(p.validate(),/50/);p.form.name='菜';p.form.categoryId='gone';assert.match(p.validate(),/重新选择/);
});
test('unadded draft blocks normal submit and prompts on cancel without sending',async()=>{
 let calls=0;const {page:p,events}=setup({addFoodOnce:async()=>{calls++}});p.stepInput='切菜';assert.equal(p.needsLeaveConfirmation(),true);await p.onSubmit();assert.equal(calls,0);assert.match(events[0],/添加或清空/);p.onCancel();assert.match(events[1].content,/未保存/);events[1].success({confirm:false});assert.equal(p.backLock,false);
});
for(const edit of [false,true])test('pending '+(edit?'edit':'create')+' retries original payload/id despite draft and unavailable categories',async()=>{
 const calls=[];const {page:p}=setup({addFoodOnce:async(...a)=>{calls.push(a);throw Error('timeout')},updateFoodOnce:async(...a)=>{calls.push(a);throw Error('timeout')}});
 const request={requestId:'fixed_request_123456789',expectedVersion:7,payload:{name:'原始内容',cover_images:['protected']}};
 if(edit){p.mode='edit';p.foodId='dish';p.pendingEdit=request}else p.pendingCreate=request;
 p.cateList=[];p.categoryError='offline';p.tagInput='unused';assert.equal(p.fieldsDisabled,true);assert.equal(p.submitDisabled,false);
 await p.onSubmit();await p.onSubmit();assert.equal(calls.length,2);
 for(const args of calls){assert.equal(args[edit?1:0],request.payload);assert.equal(args[edit?4:2],request.requestId);if(edit)assert.equal(args[3],7)}
 assert.equal(edit?p.pendingEdit:p.pendingCreate,request);
});
test('picker cancel leaves form and cleanup untouched with no error toast',async()=>{
 const {page:p,events}=setup();await p.chooseAndUploadCover();assert.equal(events.length,0);assert.equal(p.choosingCover,false);assert.equal(p.uploading,false);assert.equal(p.form.cover_images.length,0);
});
test('permission and busy states prevent entry to submission',async()=>{
 const {page:p,events}=setup();p.canManage=false;assert.equal(p.fieldsDisabled,true);await p.onSubmit();assert.match(events[0],/管理员/);p.canManage=true;p.choosingCover=true;assert.equal(p.submitDisabled,true);assert.equal(p.cancelDisabled,true);
});
test('failed initialization unlocks retry but keeps form disabled; retry recovers',async()=>{
 const {page:p,env}=setup({getCategories:async()=>[{cate_id:'1',name:'牛肉类'}]});env.getFoodCreateRequest=()=>{throw Error('记录读取失败')};await p.initializeEditor();assert.match(p.initError,/读取失败/);assert.equal(p.createInitializing,false);assert.equal(p.fieldsDisabled,true);env.getFoodCreateRequest=()=>null;await p.initializeEditor();assert.equal(p.initError,'');assert.equal(p.fieldsDisabled,false);
});
test('category retry preserves entered values and does not choose a different category',async()=>{
 const {page:p}=setup({getCategories:async()=>[{cate_id:'2',name:'羊肉类'}]});p.form.name='未保存的名字';p.form.categoryId='1';await p.retryCategories();assert.equal(p.form.name,'未保存的名字');assert.equal(p.form.categoryId,'1');assert.equal(p.cateIndex,-1);
});
test('keyboard hook resets on hide and detaches on unload',()=>{
 const {page:p,def,listeners}=setup();p.cleanupPendingCovers=()=>{};def.onReady.call(p);listeners[0]({height:300});assert.equal(p.keyboardVisible,true);def.onHide.call(p);assert.equal(p.keyboardVisible,false);listeners[0]({height:300});assert.equal(p.keyboardVisible,false);def.onShow.call(p);listeners[0]({height:0});assert.equal(p.keyboardVisible,false);def.onUnload.call(p);assert.equal(listeners.length,0);
});
