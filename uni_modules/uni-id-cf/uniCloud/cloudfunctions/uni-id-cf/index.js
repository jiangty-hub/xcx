'use strict';
let uniID = require('uni-id')
const uniCaptcha = require('uni-captcha')
const createConfig = require('uni-config-center')
const uniIdConfig = createConfig({
	pluginId: 'uni-id'
}).config()
const db = uniCloud.database()
const dbCmd = db.command
const usersDB = db.collection('uni-id-users')
const deviceDB = db.collection('uni-id-device')
async function handleRequest(event, context) {
	// 家用菜谱使用菜品管理员白名单，不开放账号体系管理员初始化。
	if (event && event.action === 'registerAdmin') {
		return {
			code: 403,
			msg: '管理员初始化入口已关闭'
		}
	}
	//UNI_WYQ:这里的uniID换成新的，保证多人访问不会冲突
	uniID = uniID.createInstance({
		context
	})
	/*
	1.event为客户端 uniCloud.callFunction填写的data的值，这里介绍一下其中的属性
		action：表示要执行的任务名称、比如：登录login、退出登录 logout等
		params：业务数据内容
		uniIdToken：系统自动传递的token，数据来源客户端的 uni.getStorageSync('uni_id_token')
	*/
	const {
		action,
		uniIdToken,
		inviteCode
	} = event;
	const deviceInfo = event.deviceInfo || {};
	let params = event.params || {},
		tokenExpired,needCaptcha;
	/*
	2.在某些操作之前我们要对用户对身份进行校验（也就是要检查用户的token）再将得到的uid写入params.uid
		校验用到的方法是uniID.checkToken 详情：https://uniapp.dcloud.io/uniCloud/uni-id?id=checktoken
		讨论，我们假设一个这样的场景，代码如下。
		如：
		uniCloud.callFunction({
			name:"xxx",
			data:{
				"params":{
					uid:"通过某种方式获取来的别人的uid"
				}
			}
		})
		用户就这样轻易地伪造了他人的uid传递给服务端，有一句话叫：前端传来的数据都是不可信任的
		所以这里我们需要将uniID.checkToken返回的uid写入到params.uid
	*/
	let noCheckAction = ['register', 'checkToken', 'login', 'logout', 'getNeedCaptcha',
		'createCaptcha', 'verifyCaptcha', 'refreshCaptcha', 'inviteLogin', 'loginByWeixin',
		'loginByUniverify', 'loginByApple'
	]
	if (!noCheckAction.includes(action)) {
		if (!uniIdToken) {
			return {
				code: 403,
				msg: '缺少token'
			}
		}
		let payload = await uniID.checkToken(uniIdToken)
		if (payload.code && payload.code > 0) {
			return payload
		}
		params.uid = payload.uid
		tokenExpired = payload.tokenExpired
	}

	//禁止前台用户传递角色
	if (action.slice(0, 7) == "loginBy") {
		if (params.role) {
			return {
				code: 403,
				msg: '禁止前台用户传递角色'
			}
		}
	}

	// 3.注册成功后触发。
	async function registerSuccess(res) {
		//用户接受邀请
		if (inviteCode) {
			await uniID.acceptInvite({
				inviteCode,
				uid
			});
		}
		//添加当前用户设备信息
		await addDeviceInfo(res)
	}
	//4.记录成功登录的日志方法
	const uniIdLog = async (res = {}) => {
		const now = Date.now()
		const uniIdLogCollection = db.collection('uni-id-log')
		let logData = {
			deviceId: context.DEVICEID,
			ip: context.CLIENTIP,
			type: res.type,
			ua: context.CLIENTUA,
			create_date: now,
			action
		};

		if (res.code === 0) {
			logData.user_id = res.uid
			logData.state = 1
			if (res.userInfo && res.userInfo.password) {
				delete res.userInfo.password
			}
			if (res.type == 'register') {
				await registerSuccess(res)
			}
			if (res.type == 'login') {
				if (Object.keys(deviceInfo).length) {
					//避免重复新增设备信息，先判断是否已存在
					let getDeviceRes = await deviceDB.where({
						"device_id": context.DEVICEID
					}).get()
					if (getDeviceRes.data.length == 0) {
						await addDeviceInfo(res)
					} else {
						await deviceDB.where({
							"device_id": context.DEVICEID,
						}).update({
							...deviceInfo,
							"tokenExpired": res.tokenExpired,
							"user_id": res.uid,
							"device_id": context.DEVICEID,
							"ua": context.CLIENTUA,
							"platform": context.PLATFORM,
							"create_date": Date.now(),
							"last_active_date": Date.now(),
							"last_active_ip": context.CLIENTIP
						})
					}
				}
			}
		} else {
			logData.state = 0
		}
		return await uniIdLogCollection.add(logData)
	}

	async function addDeviceInfo({
		uid,
		tokenExpired
	}) {
		return await deviceDB.add({
			...deviceInfo,
			tokenExpired,
			"user_id": uid,
			"device_id": context.DEVICEID,
			"ua": context.CLIENTUA,
			"platform": context.PLATFORM,
			"create_date": Date.now(),
			"last_active_date": Date.now(),
			"last_active_ip": context.CLIENTIP
		})
	}

	//5.防止恶意破解操作，连续操作失败一定次数后，需要用户提供验证码
	const isNeedCaptcha = async () => {
		//当用户最近“2小时内(recordDate)”操作失败达到2次(recordSize)时。要求用户提交验证码
		const now = Date.now(),
			recordDate = 120 * 60 * 1000,
			recordSize = 2;
		const uniIdLogCollection = db.collection('uni-id-log')
		let recentRecord = await uniIdLogCollection.where({
				ip: context.CLIENTIP,
				create_date: dbCmd.gt(now - recordDate),
				action
			})
			.orderBy('create_date', 'desc')
			.limit(recordSize)
			.get();
		return recentRecord.data.filter(item => item.state === 0).length === recordSize;
	}

	let res = {}
	switch (action) { //根据action的值执行对应的操作
		case 'renewDeviceTokenExpired':
			return await deviceDB.where({
				"user_id": params.uid,
				"device_id": context.DEVICEID
			}).update({
				"user_id": params.uid,
				"push_clientid": params.push_clientid,
				tokenExpired
			})
			break;
		case 'refreshSessionKey':
			let getSessionKey = await uniID.code2SessionWeixin({
				code: params.code
			});
			if (getSessionKey.code) {
				return getSessionKey
			}
			res = await uniID.updateUser({
				uid: params.uid,
				sessionKey: getSessionKey.sessionKey
			})
			break;
		case 'bindMobileByMpWeixin':
			let getSessionKeyRes = await uniID.getUserInfo({
				uid: params.uid,
				field: ['sessionKey']
			})
			if (getSessionKeyRes.code) {
				return getSessionKeyRes
			}
			let sessionKey = getSessionKeyRes.userInfo.sessionKey
			res = await uniID.wxBizDataCrypt({
				...params,
				sessionKey
			})
			if (res.code) {
				return res
			}
			res = await uniID.bindMobile({
				uid: params.uid,
				mobile: res.purePhoneNumber
			})
			break;
		case 'bindMobileByUniverify':
			let {
				appid, apiKey, apiSecret
			} = uniIdConfig.service.univerify
			let univerifyRes = await uniCloud.getPhoneNumber({
				provider: 'univerify',
				appid,
				apiKey,
				apiSecret,
				access_token: params.access_token,
				openid: params.openid
			})
			if (univerifyRes.code === 0) {
				res = await uniID.bindMobile({
					uid: params.uid,
					mobile: univerifyRes.phoneNumber
				})
				res.mobile = univerifyRes.phoneNumber
			}
			break;
		case 'register':
			var {
				username, password, nickname,captcha
			} = params
			if (/^1\d{10}$/.test(username)) {
				return {
					code: 401,
					msg: '用户名不能是手机号'
				}
			};
			if (/^(\w-*\.*)+@(\w-?)+(\.\w{2,})+$/.test(username)) {
				return {
					code: 401,
					msg: '用户名不能是邮箱'
				}
			}
			if(!captcha){
				return {
					code: 401,
					msg: '图形验证码不能为空'
				}
			}
			res = await uniCaptcha.verify({
				captcha,
				scene: action
			})
			if(res.code != 0){
				return res
			}
			res = await uniID.register({
				username,
				password,
				nickname,
				inviteCode
			});
      if(typeof(res.userInfo) == 'object'){
        const {inviteCode,nickname,username,_id} = res.userInfo;
        res.userInfo = {inviteCode,nickname,username,_id};
      }
			if (res.code === 0) {
				await registerSuccess(res)
			}
			break;
		case 'getNeedCaptcha': {
			const needCaptcha = await isNeedCaptcha()
			res.needCaptcha = needCaptcha
			break;
		}
		case 'login':
			let passed = false;
			needCaptcha = await isNeedCaptcha();
			if (needCaptcha) {
				res = await uniCaptcha.verify({
					...params,
					scene: 'login'
				})
				if (res.code === 0) passed = true;
			}

			if (!needCaptcha || passed) {
				res = await uniID.login({
					...params,
					queryField: ['username', 'email', 'mobile']
				});
				res.type = 'login'
				await uniIdLog(res);
				needCaptcha = await isNeedCaptcha();
			}
      if(typeof(res.userInfo) == 'object'){
        const {inviteCode,nickname,username,_id} = res.userInfo;
        res.userInfo = {inviteCode,nickname,username,_id};
      }
			res.needCaptcha = needCaptcha;
			break;
		case 'loginByWeixin':
			let loginRes = await uniID.loginByWeixin(params);
			if (loginRes.code === 0) {
				//用户完善资料（昵称、头像）
				if (context.PLATFORM == "app-plus" && !loginRes.userInfo.nickname) {
					let {
						accessToken: access_token,
						openid
					} = loginRes, {
						appid,
						appsecret: secret
					} = uniIdConfig['app-plus'].oauth.weixin;
					let wxRes = await uniCloud.httpclient.request(
						`https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&scope=snsapi_userinfo&appid=${appid}&secret=${secret}`, {
							method: 'POST',
							contentType: 'json', // 指定以application/json发送data内的数据
							dataType: 'json' // 指定返回值为json格式，自动进行parse
						})
					if (wxRes.status == 200) {
						let {
							nickname,
							headimgurl
						} = wxRes.data;
						let headimgurlFile = {},
							cloudPath = loginRes.uid + '/' + Date.now() + "headimgurl.jpg";
						let getImgBuffer = await uniCloud.httpclient.request(headimgurl)
						if (getImgBuffer.status == 200) {
							let {
								fileID
							} = await uniCloud.uploadFile({
								cloudPath,
								fileContent: getImgBuffer.data
							});
							headimgurlFile = {
								name: cloudPath,
								extname: "jpg",
								url: fileID
							}
						} else {
							return getImgBuffer
						}
						await uniID.updateUser({
							uid: loginRes.uid,
							nickname,
							avatar_file: headimgurlFile
						})
						loginRes.userInfo.nickname = nickname;
						loginRes.userInfo.avatar_file = headimgurlFile;
					} else {
						return wxRes
					}
				}
				if (context.PLATFORM == "mp-weixin") {
					let resUpdateUser = await uniID.updateUser({
						uid: loginRes.uid,
						sessionKey: loginRes.sessionKey
					})
				}
				delete loginRes.openid
				delete loginRes.sessionKey
				delete loginRes.accessToken
				delete loginRes.refreshToken
			}
			await uniIdLog(loginRes)
			return loginRes
			break;
		case 'loginByUniverify':
			res = await uniID.loginByUniverify(params)
			await uniIdLog(res)
			break;
		case 'loginByApple':
			res = await uniID.loginByApple(params)
			await uniIdLog(res)
			break;
		case 'checkToken':
			res = await uniID.checkToken(uniIdToken);
			break;
		case 'logout':
			res = await uniID.logout(uniIdToken)
			await deviceDB.where({
				"device_id": context.DEVICEID,
			}).update({
				"tokenExpired": Date.now()
			})
			break;
		case 'getInviteCode':
			res = await uniID.getUserInfo({
				uid: params.uid,
				field: ['my_invite_code']
			})
			if (res.code === 0) {
				res.myInviteCode = res.userInfo.my_invite_code
				delete res.userInfo
			}
			break;
		case 'getInvitedUser':
			res = await uniID.getInvitedUser(params)
			break;
		case 'updatePwd':
			res = await uniID.updatePwd(params)
			break;
		case 'createCaptcha':
			res = await uniCaptcha.create(params)
			break;
		case 'refreshCaptcha':
			res = await uniCaptcha.refresh(params)
			break;
		case 'getUserInviteCode':
			res = await uniID.getUserInfo({
				uid: params.uid,
				field: ['my_invite_code']
			})
			if (!res.userInfo.my_invite_code) {
				res = await uniID.setUserInviteCode({
					uid: params.uid
				})
			}
			break;
		case 'closeAccount':
			res = await uniID.closeAccount({
				uid: params.uid
			});
			break;

			// =========================== admin api start =========================
		case 'registerUser': {
			const {
				userInfo
			} = await uniID.getUserInfo({
				uid: params.uid
			})
			if (userInfo.role.indexOf('admin') === -1) {
				res = {
					code: 403,
					message: '非法访问, 无权限注册超级管理员',
				}
			} else {
				// 过滤 dcloud_appid，注册用户成功后再提交
				const dcloudAppidList = params.dcloud_appid
				delete params.dcloud_appid
				delete params.uid
				res = await uniID.register({
					autoSetDcloudAppid: false,
					...params
				})
				if (res.code === 0) {
					delete res.token
					delete res.tokenExpired
					await uniID.setAuthorizedAppLogin({
						uid: res.uid,
						dcloudAppidList
					})
				}
			}
			break;
		}
		case 'updateUser': {
			const {
				userInfo
			} = await uniID.getUserInfo({
				uid: params.uid
			})
			if (userInfo.role.indexOf('admin') === -1) {
				res = {
					code: 403,
					message: '非法访问, 无权限注册超级管理员',
				}
			} else {
				// 过滤 dcloud_appid，注册用户成功后再提交
				const dcloudAppidList = params.dcloud_appid
				delete params.dcloud_appid

				// 过滤 password，注册用户成功后再提交
				const password = params.password
				delete params.password

				// 过滤 uid、id
				const id = params.id
				delete params.id
				delete params.uid


				res = await uniID.updateUser({
					uid: id,
					...params
				})
				if (res.code === 0) {
					if (password) {
						await uniID.resetPwd({
							uid: id,
							password
						})
					}
					await uniID.setAuthorizedAppLogin({
						uid: id,
						dcloudAppidList
					})
				}
			}
			break;
		}
		case 'getCurrentUserInfo':
			res = await uniID.getUserInfo({
				uid: params.uid,
				...params
			})
			break;
		case 'managerMultiTag': {
			const {
				userInfo
			} = await uniID.getUserInfo({
				uid: params.uid
			})
			// 限制只有 admin 角色的用户可管理标签，如需非 admin 角色需自行实现
			if (userInfo.role.indexOf('admin') === -1) {
				res = {
					code: 403,
					message: '非法访问, 无权限修改用户标签',
				}
				return
			}
			let {
				ids,
				type,
				value
			} = params
			if (type === 'add') {
				res = await db.collection('uni-id-users').where({
					_id: dbCmd.in(ids)
				}).update({
					tags: dbCmd.addToSet({
						$each: value
					})
				})
			} else if (type === 'del') {
				res = await db.collection('uni-id-users').where({
					_id: dbCmd.in(ids)
				}).update({
					tags: dbCmd.pull(dbCmd.in(value))
				})
			} else {
				res = {
					code: 403,
					msg: '无效操作'
				}
				return
			}
			break;
		}
		// =========================== admin api end =========================
		default:
			res = {
				code: 403,
				msg: '非法访问'
			}
			break;
	}
	//返回数据给客户端
	return res
}


// 操作名称来自固定白名单；未知 action 不能原样写入日志。
const LOG_ACTIONS = new Set([
  "registerAdmin",
  "renewDeviceTokenExpired",
  "refreshSessionKey",
  "bindMobileByMpWeixin",
  "bindMobileByUniverify",
  "register",
  "getNeedCaptcha",
  "login",
  "loginByWeixin",
  "loginByUniverify",
  "loginByApple",
  "checkToken",
  "logout",
  "getInviteCode",
  "getInvitedUser",
  "updatePwd",
  "createCaptcha",
  "refreshCaptcha",
  "getUserInviteCode",
  "closeAccount",
  "registerUser",
  "updateUser",
  "getCurrentUserInfo",
  "managerMultiTag"
])

exports.main = async (event, context) => {
  const startedAt = Date.now()
  let outcome = 'exception'
  let code = null
  try {
    const result = await handleRequest(event, context)
    outcome = 'returned'
    // 只记录数值结果码，不打印响应、msg 或异常对象。
    const value = result?.code
    if (typeof value === 'number' && Number.isFinite(value)) code = value
    else if (typeof value === 'string' && /^-?\d{1,9}$/.test(value)) code = Number(value)
    return result
  } finally {
    // 日志故障不能改变登录返回结果；不记录 event/context、用户标识或凭证。
    try {
      console.info('uni-id-cf', {
        action: LOG_ACTIONS.has(event?.action) ? event.action : 'unknown',
        outcome,
        code,
        durationMs: Math.max(0, Date.now() - startedAt)
      })
    } catch (_) {}
  }
}
