'use strict'
const storage = require('./storage-files')
const { URL } = require('url')
const { createHash } = require('crypto')
const FILE_STATES = 'avatar_file_states'

function fileKey(fileID) {
  return createHash('sha256').update(storage.fileID(fileID) || fileID).digest('hex')
}

function firstDoc(result) {
  return Array.isArray(result.data) ? result.data[0] : result.data
}

function profileError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// 保存与清理都写同一文件状态文档，事务冲突时只能有一方提交。
// deleting 是不可逆的删除标记：即使 deleteFile 失败，也不能重新引用它。
async function saveProfileSafely(db, uid, updateData) {
  const transaction = await db.startTransaction()
  try {
    const users = transaction.collection('uni-id-users')
    const old = firstDoc(await users.doc(uid).get())
    if (!old) throw profileError(404, '用户不存在，请重新登录')
    const oldAvatar = old.avatar || ''
    if (updateData.avatar) {
      const fileID = updateData.avatar
      if (!isOwnedAvatarFile(fileID, uid)) {
        // 老头像只允许原样保留；新头像必须来自当前用户的上传目录。
        if (fileID !== oldAvatar) throw profileError(400, '头像地址无效，请重新上传头像')
      } else {
        const states = transaction.collection(FILE_STATES)
        const id = fileKey(fileID)
        const state = firstDoc(await states.doc(id).get())
        // 兼容迁移前按原始 HTTPS 地址计算的状态键；待删除标记不可被新键绕过。
        for (const alias of storage.aliases(fileID)) {
          const legacyKey = createHash('sha256').update(alias).digest('hex')
          if (legacyKey === id) continue
          const legacy = firstDoc(await states.doc(legacyKey).get())
          if (legacy && legacy.status !== 'active') throw profileError(409, '该头像已进入清理流程，请重新上传头像')
        }
        if (state && state.status !== 'active') {
          throw profileError(409, '该头像已进入清理流程，本次资料未保存，请重新上传头像')
        }
        const data = { ownerUid: uid, fileID: storage.fileID(fileID), status: 'active', updatedAt: Date.now() }
        if (state) {
          // 必须实际写入，不能只检查状态，否则无法与清理事务互斥。
          await states.doc(id).update({ ...data, revision: Number(state.revision || 0) + 1 })
        } else {
          await states.add({ _id: id, ...data, revision: 1 })
        }
      }
    }
    const changed = await users.doc(uid).update(updateData)
    const unchanged = Object.keys(updateData).every(key => old[key] === updateData[key])
    // 某些数据库实现对未改变字段的 update 返回 0，重复保存仍是成功。
    if (changed.updated !== 1 && !(changed.updated === 0 && unchanged)) {
      throw new Error('资料保存结果未确认，请重新打开页面确认')
    }
    await transaction.commit()
    return oldAvatar
  } catch (error) {
    try { await transaction.rollback() } catch (rollbackError) {
      console.warn('profile transaction rollback not confirmed:', rollbackError)
    }
    throw error
  }
}

async function claimAvatarDeletion(db, fileID) {
  const uid = new URL(fileID).pathname.split('/')[2]
  if (!isOwnedAvatarFile(fileID, uid)) throw new Error('头像归属无法确认，停止清理')
  const transaction = await db.startTransaction()
  try {
    const states = transaction.collection(FILE_STATES)
    const id = fileKey(fileID)
    const state = firstDoc(await states.doc(id).get())
    const user = firstDoc(await transaction.collection('uni-id-users').doc(uid).get())
    if (storage.sameFile(user?.avatar, fileID)) {
      await transaction.rollback()
      return false
    }
    const data = { ownerUid: uid, fileID: storage.fileID(fileID), status: 'deleting', updatedAt: Date.now() }
    if (state) {
      await states.doc(id).update({ ...data, revision: Number(state.revision || 0) + 1 })
    } else {
      await states.add({ _id: id, ...data, revision: 1 })
    }
    await transaction.commit()
    return true
  } catch (error) {
    try { await transaction.rollback() } catch (rollbackError) {
      console.warn('avatar cleanup transaction rollback not confirmed:', rollbackError)
    }
    throw error
  }
}

// 两个云函数各自携带此文件；修改规则时同步更新并部署。
const isOwnedAvatarFile = storage.isOwnedAvatarFile

// 兼容曾被其他用户或菜品引用的头像；检查失败时由调用方保留重试。
async function excludeReferencedAvatars(db, fileIDs) {
  const referenced = []
  const deletable = []
  for (const id of fileIDs) {
    const forms = storage.aliases(id)
    if (!forms.length) throw new Error('头像地址无效')
    const users = await db.collection('uni-id-users').where({ avatar: db.command.in(forms) }).limit(1).get()
    const foods = await db.collection('foods').where({ cover_images: db.command.in(forms) }).limit(1).get()
    const legacyFoods = await db.collection('foods').where({ images: db.command.in(forms) }).limit(1).get()
    if (![users, foods, legacyFoods].every(res => Array.isArray(res?.data))) throw new Error('头像引用查询结果未确认')
    if (users.data.length || foods.data.length || legacyFoods.data.length) {
      referenced.push(id)
    } else if (await claimAvatarDeletion(db, id)) {
      deletable.push(id)
    } else {
      referenced.push(id)
    }
  }
  return { referenced, deletable }
}

module.exports = { isOwnedAvatarFile, excludeReferencedAvatars, saveProfileSafely }
