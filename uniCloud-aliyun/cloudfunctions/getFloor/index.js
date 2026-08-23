'use strict';

exports.main = async () => {
  const db = uniCloud.database()
  const res = await db.collection('floor')
    .orderBy('sort', 'asc')
    .orderBy('_id', 'asc')
    .get()
  return {
    code: 0,
    data: [
      res.data
    ]
  }
}
