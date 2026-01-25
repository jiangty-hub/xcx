'use strict';
exports.main = async () => {
  const db = uniCloud.database()
  const res = await db.collection('icon').get()

  return {
    code: 0,
    data: res.data
  }
}