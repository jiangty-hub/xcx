'use strict'

const db = uniCloud.database()
const MAX_ATTEMPTS = 10
const TASK_BATCH_SIZE = 50
const STORAGE_FILE_BATCH_SIZE = 50

function chunkList(list, size = STORAGE_FILE_BATCH_SIZE) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

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

function isOwnedAvatarFile(fileID, ownerUid) {
  return typeof ownerUid === 'string' && ownerUid.length > 0 &&
    typeof fileID === 'string' && fileID.startsWith('cloud://') &&
    fileID.includes(`/avatar/${ownerUid}/`)
}

async function deleteInBatches(fileIDs) {
  const failedFileIDs = []
  const errors = []

  for (const batch of chunkList(fileIDs)) {
    try {
      await uniCloud.deleteFile({ fileList: batch })
    } catch (e) {
      failedFileIDs.push(...batch)
      errors.push(e?.message || '云存储删除失败')
    }
  }

  return {
    failedFileIDs,
    error: [...new Set(errors)].join('; ')
  }
}

async function excludeReferencedFoodCovers(fileIDs) {
  const list = [...new Set((Array.isArray(fileIDs) ? fileIDs : []).filter(isFoodCoverFile))]
  const referenced = new Set()

  for (const batch of chunkList(list)) {
    let offset = 0
    while (true) {
      const res = await db.collection('foods')
        .where({ cover_images: db.command.in(batch) })
        .field({ cover_images: true })
        .skip(offset)
        .limit(100)
        .get()

      const docs = res.data || []
      docs.forEach((doc) => {
        const covers = Array.isArray(doc.cover_images) ? doc.cover_images : []
        covers.forEach((fileID) => {
          if (batch.includes(fileID)) referenced.add(fileID)
        })
      })

      if (docs.length < 100) break
      offset += docs.length
    }
  }

  return {
    deletable: list.filter((fileID) => !referenced.has(fileID)),
    referenced: list.filter((fileID) => referenced.has(fileID))
  }
}

async function excludeCurrentAvatar(fileIDs, ownerUid) {
  const list = [...new Set((Array.isArray(fileIDs) ? fileIDs : [])
    .filter((fileID) => isOwnedAvatarFile(fileID, ownerUid)))]
  if (!list.length) return { deletable: [], referenced: [] }

  const res = await db.collection('uni-id-users')
    .doc(ownerUid)
    .field({ avatar: true })
    .get()
  const currentAvatar = res.data?.[0]?.avatar || ''

  return {
    deletable: list.filter((fileID) => fileID !== currentAvatar),
    referenced: list.filter((fileID) => fileID === currentAvatar)
  }
}

exports.main = async () => {
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

    if (taskType === 'avatar') {
      fileIDs = [...new Set((Array.isArray(task.fileIDs) ? task.fileIDs : [])
        .filter((fileID) => isOwnedAvatarFile(fileID, task.ownerUid)))]
      emptyMessage = '没有属于指定用户的头像文件'
    } else if (taskType === 'food') {
      fileIDs = [...new Set((Array.isArray(task.fileIDs) ? task.fileIDs : []).filter(isFoodCoverFile))]
      emptyMessage = '没有可清理的 foods 图片文件'
    } else {
      emptyMessage = `不支持的清理任务类型: ${taskType}`
    }

    if (!fileIDs.length) {
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: 'failed',
        lastError: emptyMessage,
        updatedAt: now
      })
      failed += 1
      continue
    }

    const { deletable } = taskType === 'avatar'
      ? await excludeCurrentAvatar(fileIDs, task.ownerUid)
      : await excludeReferencedFoodCovers(fileIDs)
    const result = await deleteInBatches(deletable)

    if (!result.failedFileIDs.length) {
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: 'done',
        lastError: '',
        completedAt: now,
        updatedAt: now
      })
      completed += 1
    } else {
      const attempts = Number(task.attempts || 0) + 1
      await db.collection('file_cleanup_tasks').doc(task._id).update({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        fileIDs: result.failedFileIDs,
        lastError: result.error || '云存储删除失败',
        updatedAt: now
      })
      failed += 1
    }
  }

  return { processed: (tasks.data || []).length, completed, failed }
}
