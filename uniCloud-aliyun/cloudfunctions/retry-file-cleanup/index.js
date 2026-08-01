'use strict'

const db = uniCloud.database()
const MAX_ATTEMPTS = 10
const BATCH_SIZE = 50

function isFoodCoverFile(fileID) {
  if (typeof fileID !== 'string') return false
  if (fileID.startsWith('cloud://')) return fileID.includes('/foods/')

  if (/^https?:\/\//i.test(fileID)) {
    try {
      return new URL(fileID).pathname.includes('/foods/')
    } catch (e) {
      return false
    }
  }

  return false
}

exports.main = async () => {
  const tasks = await db.collection('file_cleanup_tasks')
    .where({ status: 'pending' })
    .orderBy('createdAt', 'asc')
    .limit(BATCH_SIZE)
    .get()

  let completed = 0
  let failed = 0

  for (const task of tasks.data || []) {
    const fileIDs = (Array.isArray(task.fileIDs) ? task.fileIDs : []).filter(isFoodCoverFile)
    const now = Date.now()

    if (!fileIDs.length) {
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: 'failed',
        lastError: '没有可清理的 foods 图片文件',
        updatedAt: now
      })
      failed += 1
      continue
    }

    try {
      await uniCloud.deleteFile({ fileList: fileIDs })
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: 'done',
        lastError: '',
        completedAt: now,
        updatedAt: now
      })
      completed += 1
    } catch (e) {
      const attempts = Number(task.attempts || 0) + 1
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        lastError: e?.message || '云存储删除失败',
        updatedAt: now
      })
      failed += 1
    }
  }

  return { processed: (tasks.data || []).length, completed, failed }
}
