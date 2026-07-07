'use strict'
const uniID = require('uni-id-common')

exports.main = async (event, context) => {
  const { token } = event || {}
  const uniIdIns = uniID.createInstance({ context })

  if (!token) return { code: 401, msg: '缺少token' }

  const payload = await uniIdIns.checkToken(token)
  if (payload.code) return { code: 401, msg: payload.msg || '未登录' }

  const uid = payload.uid
  const db = uniCloud.database()

  const { data } = await db
    .collection('uni-id-users')
    .doc(uid)
    .field({ nickname: true, avatar: true })
    .get()

  const user = (data && data[0]) ? data[0] : {}

  return {
    code: 0,
    msg: 'ok',
    uid,
    profile: {
      nickname: user.nickname || '',
      avatar: user.avatar || ''
    }
  }
}
