'use strict'
const uniID = require('uni-id-common')
const { isOwnedAvatarFile, excludeReferencedAvatars, saveProfileSafely } = require('./avatar-files')

exports.main = async (event, context) => {
  const { token, nickname, avatar, cleanupAvatarFileIds } = event || {}
  const uniIdIns = uniID.createInstance({ context })

  if (!token) return { code: 401, msg: '缺少token' }

  const payload = await uniIdIns.checkToken(token)
  if (payload.code) {
    // ✅ 统一成 401，前端更好判断“登录失效”
    return { code: 401, msg: payload.msg || '未登录' }
  }

  const uid = payload.uid
  const db = uniCloud.database()
  const authResult = {
    newToken: payload.token
      ? { token: payload.token, tokenExpired: payload.tokenExpired }
      : undefined,
    tokenExpired: payload.tokenExpired
  }

  function getOwnedAvatarFileIDs(fileIDs) {
    return [...new Set((Array.isArray(fileIDs) ? fileIDs : [])
      .filter((fileID) => isOwnedAvatarFile(fileID, uid)))]
  }

  async function enqueueAvatarCleanup(fileIDs, reason, error) {
    const list = getOwnedAvatarFileIDs(fileIDs)
    if (!list.length) return false

    let queued = 0
    for (let i = 0; i < list.length; i += 50) {
      const batch = list.slice(i, i + 50)
      try {
        const now = Date.now()
        await db.collection('file_cleanup_tasks').add({
          taskType: 'avatar',
          ownerUid: uid,
          fileIDs: batch,
          reason,
          lastError: error || '',
          status: 'pending',
          attempts: 0,
          createdAt: now,
          updatedAt: now
        })
        queued += 1
      } catch (e) {
        console.error('enqueue avatar cleanup failed:', e)
      }
    }

    return queued === Math.ceil(list.length / 50)
  }

  async function deleteOwnedAvatars(fileIDs, protectedAvatar = '', reason = 'avatar-cleanup') {
    const source = [...new Set((Array.isArray(fileIDs) ? fileIDs : [])
      .filter((id) => typeof id === 'string' && id))]
    const owned = getOwnedAvatarFileIDs(source)
    const result = {
      deleted: 0, deletedFileIDs: [], failedFileIDs: [], queuedFileIDs: [],
      protectedFileIDs: source.filter((id) => id === protectedAvatar),
      skippedFileIDs: source.filter((id) => id !== protectedAvatar && !owned.includes(id)),
      confirmedFileIDs: [], error: '', queued: false
    }
    const candidates = owned.filter((id) => id !== protectedAvatar)
    let deletable = []
    try {
      const checked = await excludeReferencedAvatars(db, candidates)
      deletable = checked.deletable
      result.protectedFileIDs.push(...checked.referenced)
    } catch (e) {
      result.failedFileIDs.push(...candidates)
      result.error = e?.message || '头像引用检查失败'
    }
    for (let i = 0; i < deletable.length; i += 50) {
      const batch = deletable.slice(i, i + 50)
      try {
        await uniCloud.deleteFile({ fileList: batch })
        result.deletedFileIDs.push(...batch)
      } catch (e) {
        result.failedFileIDs.push(...batch)
        result.error = e?.message || '头像文件删除失败'
      }
    }
    if (result.failedFileIDs.length) {
      result.queued = await enqueueAvatarCleanup(result.failedFileIDs, reason, result.error)
      if (result.queued) result.queuedFileIDs = [...result.failedFileIDs]
    }
    result.deleted = result.deletedFileIDs.length
    result.skipped = result.skippedFileIDs.length
    result.skipReason = result.skipped ? '文件归属或地址格式无法确认，保留待核对' : ''
    result.confirmedFileIDs = [...result.deletedFileIDs, ...result.protectedFileIDs, ...result.queuedFileIDs]
    return result
  }

  const updateData = {}

  // ✅ nickname：undefined = 不改；string = 更新/清空
  if (nickname !== undefined) {
    if (typeof nickname !== 'string') return { code: 400, msg: 'nickname类型错误', ...authResult }
    const n = nickname.trim()
    // 允许清空：传 "" 或 "   " 会清空
    if (n.length > 20) return { code: 400, msg: '昵称最长20字符', ...authResult }
    updateData.nickname = n
  }

  // ✅ avatar：undefined = 不改；string = 更新/清空
  if (avatar !== undefined) {
    if (typeof avatar !== 'string') return { code: 400, msg: 'avatar类型错误', ...authResult }
    const a = avatar.trim()
    // 允许清空；新头像的归属和删除状态在保存事务内校验。
    updateData.avatar = a
  }

  let oldAvatar = ''
  if (Object.keys(updateData).length) {
    try {
      oldAvatar = await saveProfileSafely(db, uid, updateData)
    } catch (error) {
      if ([400, 404, 409].includes(error.code)) {
        return { code: error.code, msg: error.message, ...authResult }
      }
      throw error
    }
  } else {
    const oldRes = await db.collection('uni-id-users').doc(uid).field({ avatar: true }).get()
    oldAvatar = oldRes.data?.[0]?.avatar || ''
  }

  const currentAvatar = avatar !== undefined ? updateData.avatar : oldAvatar
  const cleanupCandidates = Array.isArray(cleanupAvatarFileIds) ? [...cleanupAvatarFileIds] : []
  if (avatar !== undefined && currentAvatar !== oldAvatar && oldAvatar) {
    cleanupCandidates.push(oldAvatar)
  }
  const cleanup = await deleteOwnedAvatars(cleanupCandidates, currentAvatar, 'update-user-profile')

  return {
    code: 0,
    msg: Object.keys(updateData).length ? 'ok' : 'no changes',
    cleanup,
    ...authResult
  }
}
