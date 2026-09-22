'use strict'
const { URL } = require('url')
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

// 本项目阿里云文件的实际地址；更换服务空间时需同步更新两个清理云函数。
const FOOD_STORAGE_HOST = 'mp-e3a48079-7f55-4c65-8f6c-9d757e567f86.cdn.bspapp.com'

function isFoodCoverFile(fileID) {
  if (typeof fileID !== 'string') return false
  if (fileID.startsWith('cloud://')) return fileID.includes('/foods/')

  try {
    const url = new URL(fileID)
    // 仅接受本空间的原始文件地址，避免临时签名或地址别名绕过引用检查。
    if (url.protocol !== 'https:' || url.hostname !== FOOD_STORAGE_HOST ||
        url.username || url.password || url.port || url.search || url.hash || url.href !== fileID) return false
    return /^\/(?:cloudstorage|foods)\/.+/.test(url.pathname) && !url.pathname.endsWith('/')
  } catch (e) {
    return false
  }
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

    // cloudstorage 同时存放菜品和头像，清理前也保护用户当前使用的头像。
    let userOffset = 0
    while (true) {
      const res = await db.collection('uni-id-users')
        .where({ avatar: db.command.in(batch) })
        .field({ avatar: true })
        .skip(userOffset)
        .limit(100)
        .get()
      const users = res.data || []
      users.forEach((user) => {
        if (batch.includes(user.avatar)) referenced.add(user.avatar)
      })
      if (users.length < 100) break
      userOffset += users.length
    }
  }

  return {
    deletable: list.filter((fileID) => !referenced.has(fileID)),
    referenced: list.filter((fileID) => referenced.has(fileID))
  }
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
