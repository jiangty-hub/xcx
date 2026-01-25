'use strict';
const uniID = require('uni-id-common');

exports.main = async (event, context) => {
  const { token, nickname, avatar } = event || {};
  const uniIdIns = uniID.createInstance({ context });

  if (!token) return { code: 401, msg: '缺少token' };

  const payload = await uniIdIns.checkToken(token);
  if (payload.code) {
    return { code: payload.code, msg: payload.msg || '未登录' };
  }

  const uid = payload.uid;
  const db = uniCloud.database();

  const updateData = {};
  if (typeof nickname === 'string' && nickname.trim()) updateData.nickname = nickname.trim();
  if (typeof avatar === 'string' && avatar.trim()) updateData.avatar = avatar.trim();

  if (!Object.keys(updateData).length) {
    return { code: 0, msg: 'no changes' };
  }

  await db.collection('uni-id-users').doc(uid).update(updateData);
  return { code: 0, msg: 'ok' };
};
