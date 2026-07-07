'use strict';

exports.main = async (event, context) => {
  const db = uniCloud.database()
  const _ = db.command

  // table：uni-id-log
  const col = db.collection('uni-id-log')

  // 只保留 7 天
  const keepDays = 7
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000

  // 先统计将要删除多少条
  const countRes = await col
    .where({ create_date: _.lt(cutoff) })
    .count()

  const willDelete = countRes.total

  // 如果没有需要删除的，直接返回
  if (willDelete === 0) {
    return {
      ok: true,
      keepDays,
      willDelete: 0,
      deleted: 0
    }
  }

  /**
   * 分批删除（更稳）
   * uniCloud 有时大量 remove 会超时/超限制，所以按批次删
   * 每批最多删 batchSize 条
   */
  const batchSize = 500
  let deletedTotal = 0

  while (true) {
    // 取出一批旧日志的 _id
    const listRes = await col
      .where({ create_date: _.lt(cutoff) })
      .field({ _id: true })
      .limit(batchSize)
      .get()

    const ids = listRes.data.map(d => d._id)
    if (ids.length === 0) break

    // 按 _id 批量删除
    const delRes = await col
      .where({ _id: _.in(ids) })
      .remove()

    deletedTotal += delRes.deleted || 0

    // 如果这一批没删到，避免死循环
    if (!delRes.deleted) break
  }

  return {
    ok: true,
    keepDays,
    willDelete,
    deleted: deletedTotal
  }
}
