'use strict';
exports.main = async () => {
  const db = uniCloud.database()
  const res = await db.collection('banner').get()

  return {
    code: 0,
    data: res.data
  }
}
