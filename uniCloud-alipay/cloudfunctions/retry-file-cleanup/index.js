'use strict'
const storage = require('./storage-files')
const { isOwnedAvatarFile, excludeReferencedAvatars } = require('./avatar-files')

const db = uniCloud.database()
const MAX_ATTEMPTS = 10
const TASK_BATCH_SIZE = 50
const STORAGE_FILE_BATCH_SIZE = 50
const ALLOWED_SOURCES = new Set(['timing', 'server'])

function chunkList(list, size = STORAGE_FILE_BATCH_SIZE) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

const isFoodCoverFile = storage.isFoodCoverFile

async function deleteInBatches(fileIDs) {
  return storage.deleteFiles(uniCloud, fileIDs)
}

async function excludeReferencedFoodCovers(fileIDs) {
  return storage.excludeReferencedFoodCovers(db, Array.isArray(fileIDs) ? fileIDs : [])
}

exports.main = async (event, context) => {
  // 只信任平台提供的调用来源；业务参数不能放行清理操作。
  if (!ALLOWED_SOURCES.has(context?.SOURCE)) {
    return { code: 403, msg: '不允许通过此来源执行清理' }
  }

  const tasks = await db.collection('file_cleanup_tasks')
    .where({ status: 'pending' })
    .orderBy('createdAt', 'asc')
    .limit(TASK_BATCH_SIZE)
    .get()

  let completed = 0
  let failed = 0

  for (const task of tasks.data || []) {
    const now = Date.now()
    const taskType = task.taskType || 'food'
    let fileIDs = []
    let emptyMessage = ''
    let skippedFileIDs = []

    if (taskType === 'avatar') {
      fileIDs = [...new Set((Array.isArray(task.fileIDs) ? task.fileIDs : [])
        .filter((fileID) => isOwnedAvatarFile(fileID, task.ownerUid)))]
      skippedFileIDs = (Array.isArray(task.fileIDs) ? task.fileIDs : [])
        .filter((id) => !isOwnedAvatarFile(id, task.ownerUid))
      emptyMessage = '没有属于指定用户的头像文件'
    } else if (taskType === 'food') {
      fileIDs = [...new Set((Array.isArray(task.fileIDs) ? task.fileIDs : []).filter(isFoodCoverFile))]
      skippedFileIDs = (Array.isArray(task.fileIDs) ? task.fileIDs : []).filter((id) => !isFoodCoverFile(id))
      emptyMessage = '没有本项目支持的菜品图片地址'
    } else {
      emptyMessage = `不支持的清理任务类型: ${taskType}`
    }

    if (!fileIDs.length) {
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: 'failed',
        lastError: emptyMessage,
        skippedFileIDs,
        updatedAt: now
      })
      failed += 1
      continue
    }

    let result
    try {
      const { deletable } = taskType === 'avatar'
        ? await excludeReferencedAvatars(db, fileIDs)
        : await excludeReferencedFoodCovers(fileIDs)
      result = await deleteInBatches(deletable)
    } catch (e) {
      // 引用检查失败时不删除文件，并保留任务供下次重试。
      result = { failedFileIDs: fileIDs, error: e?.message || '图片引用检查失败' }
    }

    if (!result.failedFileIDs.length) {
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: skippedFileIDs.length ? 'failed' : 'done',
        lastError: skippedFileIDs.length ? '部分图片地址不受支持，已跳过' : '',
        skippedFileIDs,
        completedAt: now,
        updatedAt: now
      })
      if (skippedFileIDs.length) failed += 1
      else completed += 1
    } else {
      const attempts = Number(task.attempts || 0) + 1
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        fileIDs: [...result.failedFileIDs, ...skippedFileIDs],
        skippedFileIDs,
        lastError: result.error || '云存储删除失败',
        updatedAt: now
      })
      failed += 1
    }
  }

  return { processed: (tasks.data || []).length, completed, failed }
}
