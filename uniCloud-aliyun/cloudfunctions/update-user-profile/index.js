'use strict'
const uniID = require('uni-id-common')

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
    const prefix = `/avatar/${uid}/`
    return [...new Set((Array.isArray(fileIDs) ? fileIDs : [])
      .filter((fileID) => typeof fileID === 'string' && fileID.startsWith('cloud://') && fileID.includes(prefix)))]
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
    const source = Array.isArray(fileIDs) ? fileIDs : []
    const list = getOwnedAvatarFileIDs(source)
      .filter((fileID) => fileID !== protectedAvatar)
    const protectedFileIDs = [...new Set(source.filter((fileID) => fileID === protectedAvatar))]
    if (!list.length) {
      return { deleted: 0, failedFileIDs: [], protectedFileIDs, error: '', queued: false }
    }

    let deleted = 0
    const failedFileIDs = []
    const errors = []
    for (let i = 0; i < list.length; i += 50) {
      const batch = list.slice(i, i + 50)
      try {
        await uniCloud.deleteFile({ fileList: batch })
        deleted += batch.length
      } catch (e) {
        console.error('delete avatar files failed:', e)
        failedFileIDs.push(...batch)
        errors.push(e?.message || '头像文件删除失败')
      }
    }

    const result = {
      deleted,
      failedFileIDs,
      protectedFileIDs,
      error: [...new Set(errors)].join('; '),
      queued: false
    }
    if (failedFileIDs.length) {
      result.queued = await enqueueAvatarCleanup(failedFileIDs, reason, result.error)
    }
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
    // 允许清空：传 "" 或 "   " 会清空
    // 如果你只允许 cloud:// 或 http(s)，可以加更严格校验：
    // if (a && !/^cloud:\/\/|^https?:\/\//i.test(a)) return { code: 400, msg: 'avatar格式错误' }
    updateData.avatar = a
  }

  const oldRes = await db.collection('uni-id-users').doc(uid).field({ avatar: true }).get()
  const oldAvatar = oldRes.data?.[0]?.avatar || ''
  if (Object.keys(updateData).length) {
    await db.collection('uni-id-users').doc(uid).update(updateData)
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
