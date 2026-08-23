'use strict'

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 500

async function removeInBatches(collection, condition, command) {
  const countRes = await collection.where(condition).count()
  const willDelete = Number(countRes.total || 0)
  let deleted = 0

  while (true) {
    const listRes = await collection
      .where(condition)
      .field({ _id: true })
      .limit(BATCH_SIZE)
      .get()
    const ids = (listRes.data || []).map((item) => item._id).filter(Boolean)
    if (!ids.length) break

    const delRes = await collection
      .where({ _id: command.in(ids) })
      .remove()
    const batchDeleted = Number(delRes.deleted || 0)
    deleted += batchDeleted
    if (!batchDeleted) break
  }

  return { willDelete, deleted }
}

exports.main = async () => {
  const db = uniCloud.database()
  const command = db.command
  const now = Date.now()
  const errors = []

  const keepDays = 7
  let uniIdLog = { willDelete: 0, deleted: 0 }
  try {
    uniIdLog = await removeInBatches(
      db.collection('uni-id-log'),
      { create_date: command.lt(now - keepDays * DAY_MS) },
      command
    )
  } catch (e) {
    console.error('clean uni-id-log failed:', e)
    errors.push(`uni-id-log: ${e?.message || '清理失败'}`)
  }

  // 已完成任务保留 30 天，最终失败任务保留 90 天，pending 任务永不在这里删除。
  const cleanupTasks = {
    done: { keepDays: 30, willDelete: 0, deleted: 0 },
    failed: { keepDays: 90, willDelete: 0, deleted: 0 }
  }
  const taskCollection = db.collection('file_cleanup_tasks')

  for (const status of ['done', 'failed']) {
    const item = cleanupTasks[status]
    try {
      const result = await removeInBatches(taskCollection, {
        status,
        createdAt: command.lt(now - item.keepDays * DAY_MS)
      }, command)
      Object.assign(item, result)
    } catch (e) {
      console.error(`clean ${status} file cleanup tasks failed:`, e)
      errors.push(`file_cleanup_tasks/${status}: ${e?.message || '清理失败'}`)
    }
  }

  return {
    ok: errors.length === 0,
    // 保留旧返回字段，方便云函数日志和既有调用继续读取。
    keepDays,
    willDelete: uniIdLog.willDelete,
    deleted: uniIdLog.deleted,
    uniIdLog: { keepDays, ...uniIdLog },
    cleanupTasks,
    errors
  }
}
