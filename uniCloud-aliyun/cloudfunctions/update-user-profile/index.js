'use strict'
const uniID = require('uni-id-common')

exports.main = async (event, context) => {
  const { token, nickname, avatar } = event || {}
  const uniIdIns = uniID.createInstance({ context })

  if (!token) return { code: 401, msg: '缺少token' }

  const payload = await uniIdIns.checkToken(token)
  if (payload.code) {
    // ✅ 统一成 401，前端更好判断“登录失效”
    return { code: 401, msg: payload.msg || '未登录' }
  }

  const uid = payload.uid
  const db = uniCloud.database()

  const updateData = {}

  // ✅ nickname：undefined = 不改；string = 更新/清空
  if (nickname !== undefined) {
    if (typeof nickname !== 'string') return { code: 400, msg: 'nickname类型错误' }
    const n = nickname.trim()
    // 允许清空：传 "" 或 "   " 会清空
    if (n.length > 20) return { code: 400, msg: '昵称最长20字符' }
    updateData.nickname = n
  }

  // ✅ avatar：undefined = 不改；string = 更新/清空
  if (avatar !== undefined) {
    if (typeof avatar !== 'string') return { code: 400, msg: 'avatar类型错误' }
    const a = avatar.trim()
    // 允许清空：传 "" 或 "   " 会清空
    // 如果你只允许 cloud:// 或 http(s)，可以加更严格校验：
    // if (a && !/^cloud:\/\/|^https?:\/\//i.test(a)) return { code: 400, msg: 'avatar格式错误' }
    updateData.avatar = a
  }

  if (!Object.keys(updateData).length) {
    return { code: 0, msg: 'no changes' }
  }

  await db.collection('uni-id-users').doc(uid).update(updateData)
  return { code: 0, msg: 'ok' }
}
