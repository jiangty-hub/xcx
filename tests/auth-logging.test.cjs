const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const cloudFile = process.env.AUTH_LOG_TEST_FILE || path.join(__dirname, '../uni_modules/uni-id-cf/uniCloud/cloudfunctions/uni-id-cf/index.js')
const secret = 'sensitive-canary-4fd719'
function load({ fail = false, brokenLogger = false } = {}) {
  const logs = [], operations = [], sdkCalls = []
  const failure = new Error(secret)
  const db = { command: { gt: v => v }, collection: name => ({
    where() { return this }, orderBy() { return this }, limit() { return this },
    async get() { return { data: [] } },
    async add(row) { operations.push({ name, row }); return { id: 'record' } },
    async update(row) { operations.push({ name, row }); return { updated: 1 } }
  }) }
  const sdk = {
    createInstance() { return this },
    async checkToken(token) { sdkCalls.push(['checkToken',token]);return { code: 0, uid: 'user', token: secret } },
    async login(params) { sdkCalls.push(['login', params]);return { code: 0, uid: 'user', token: secret, userInfo: { password: secret, nickname: 'n' } } },
    async loginByWeixin(params) { sdkCalls.push(['weixin',params]);if(fail)throw failure;return { code: 0, uid: 'user', token: secret, sessionKey: secret, openid: secret, accessToken: secret, refreshToken: secret } },
    async loginByUniverify() { return { code: 0, uid: 'user', token: secret } },
    async logout(token) { sdkCalls.push(['logout',token]);return { code: 0 } },
    async updateUser(params) { sdkCalls.push(['updateUser',params]);return { code: 0, sessionKey: secret } },
    async getUserInfo() { return { code: 0, userInfo: { sessionKey: secret, role: [], password: secret } } },
    async wxBizDataCrypt() { return { code: 0, purePhoneNumber: secret } },
    async bindMobile() { return { code: 0, mobile: secret } }
  }
  const sandbox = {
    exports: {}, uniCloud: { database: () => db },
    require(name) {
      if (name === 'uni-id') return sdk
      if (name === 'uni-captcha') return { verify: async()=>({code:0}) }
      if (name === 'uni-config-center') return () => ({config:()=>({})})
      throw new Error('Unexpected require')
    },
    console: Object.fromEntries(['log','info','warn','error','debug'].map(level=>[level,(...args)=>{if(brokenLogger)throw new Error('logger down');logs.push({level,args})}]))
  }
  vm.runInNewContext(fs.readFileSync(cloudFile,'utf8'),sandbox)
  return { call: sandbox.exports.main, logs, operations, sdkCalls, failure }
}
function checkLogs(logs, action, outcome='returned') {
  assert.equal(logs.length,1)
  assert(!JSON.stringify(logs).includes(secret))
  assert.equal(logs[0].level,'info')
  assert.equal(logs[0].args[0],'uni-id-cf')
  const row=logs[0].args[1]
  assert.deepEqual(Object.keys(row).sort(),['action','code','durationMs','outcome'])
  assert.equal(row.action,action);assert.equal(row.outcome,outcome)
  assert(Number.isFinite(row.durationMs));assert(row.durationMs>=0)
}
const context = { PLATFORM: 'mp-weixin', uniIdToken: secret, DEVICEID: secret, CLIENTIP: secret, CLIENTUA: secret }
for(const action of ['login','loginByWeixin','loginByUniverify','bindMobileByMpWeixin','registerUser','checkToken','logout']) {
  test(action + ': no credentials in logs; business result retained', async()=>{
    const {call,logs,operations,sdkCalls}=load()
    const result=await call({action,uniIdToken:secret,params:{username:'u',password:secret,code:secret,access_token:secret,openid:secret},deviceInfo:{label:secret}},context)
    checkLogs(logs,action)
    assert.equal(result.code,action==='registerUser'?403:0)
    if(['login','loginByWeixin','loginByUniverify','checkToken'].includes(action))assert.equal(result.token,secret)
    if(['login','loginByWeixin','loginByUniverify'].includes(action))assert(operations.some(x=>x.name==='uni-id-log'))
    if(action==='loginByWeixin') {
      assert.equal(result.sessionKey,undefined)
      assert.equal(result.openid,undefined)
      assert(sdkCalls.some(x=>x[0]==='updateUser'&&x[1].sessionKey===secret))
    }
  })
}
test('early rejection logs only summary',async()=>{
  const {call,logs}=load();const result=await call({action:'registerAdmin',params:{password:secret}},context)
  assert.equal(result.code,403);checkLogs(logs,'registerAdmin')
})
test('untrusted action never appears verbatim in logs',async()=>{
  const {call,logs}=load();const result=await call({action:secret},context)
  assert.equal(result.code,403);checkLogs(logs,'unknown')
})
test('exception propagates unchanged without our logger printing error contents',async()=>{
  const {call,logs,failure}=load({fail:true})
  await assert.rejects(call({action:'loginByWeixin',params:{code:secret}},context),error=>error===failure)
  checkLogs(logs,'loginByWeixin','exception');assert.equal(logs[0].args[1].code,null)
})
test('logging failure does not break successful login',async()=>{
  const {call}=load({brokenLogger:true});const result=await call({action:'loginByWeixin',params:{code:secret}},context)
  assert.equal(result.code,0);assert.equal(result.token,secret)
})
