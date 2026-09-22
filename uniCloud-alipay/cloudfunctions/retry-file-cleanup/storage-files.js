'use strict'
const { URL } = require('url')
const SPACE = 'env-00jy6ttlqgid'
const HOST = `${SPACE}.normal.cloudstatic.cn`
// 仅用于查找迁移前的引用和状态；不能凭旧地址直接发起删除。
const LEGACY_HOST = 'mp-e3a48079-7f55-4c65-8f6c-9d757e567f86.cdn.bspapp.com'

function fileID(value) {
  if (typeof value !== 'string') return ''
  try {
    const u = new URL(value)
    if (u.href !== value || u.username || u.password || u.port || u.search || u.hash) return ''
    if (!((u.protocol === 'https:' && u.hostname === HOST) || (u.protocol === 'cloud:' && u.hostname === SPACE))) return ''
    // 不猜测转义路径的别名，无法明确归属的地址保留待核对。
    if (!u.pathname.startsWith('/') || u.pathname.includes('%') || u.pathname.includes('\\') || u.pathname.split('/').slice(1).some(p => !p || p === '.' || p === '..')) return ''
    return `cloud://${SPACE}${u.pathname}`
  } catch (_) { return '' }
}
function aliases(value, includeLegacy = true) {
  const id = fileID(value)
  if (!id) return []
  const p = new URL(id).pathname
  return [id, `https://${HOST}${p}`, ...(includeLegacy ? [`https://${LEGACY_HOST}${p}`] : [])]
}
function sameFile(a, b) { return a === b || (!!fileID(a) && fileID(a) === fileID(b)) }
function isFoodCoverFile(value) {
  const id = fileID(value)
  return !!id && /^\/(?:foods|cloudstorage)\/.+/.test(new URL(id).pathname)
}
function isOwnedAvatarFile(value, uid) {
  if (typeof uid !== 'string' || !/^[\w-]+$/.test(uid)) return false
  const id = fileID(value)
  if (!id) return false
  const p = new URL(id).pathname, prefix = `/avatar/${uid}/`
  return p.startsWith(prefix) && /^[\w.-]+$/.test(p.slice(prefix.length)) && !['.', '..'].includes(p.slice(prefix.length))
}

// 保留调用者传入的地址用于前端待清理队列回执；API 仅接收去重后的 cloud ID。
async function deleteFiles(cloud, values) {
  const source = [...new Set(values)]
  const groups = new Map(), succeeded = new Set(), errors = [], requestIds = []
  for (const value of source) {
    const id = fileID(value)
    if (!id || !(isFoodCoverFile(value) || isOwnedAvatarFile(value, new URL(id).pathname.split('/')[2]))) {
      errors.push('文件归属或路径无法确认')
      continue
    }
    groups.set(id, true)
  }
  const ids = [...groups.keys()]
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    try {
      const res = await cloud.deleteFile({ fileList: batch })
      if (res?.requestId) requestIds.push(res.requestId)
      // 文档定义 fileList 为逐文件结果；缺失结果不能确认物理删除。
      if (!res || hasFailure(res) || !Array.isArray(res.fileList)) throw new Error('云存储删除结果未确认')
      for (const id of batch) {
        const rows = res.fileList.filter(row => row && fileID(row.fileID) === id)
        if (rows.length === 1 && !hasFailure(rows[0])) succeeded.add(id)
        else errors.push('部分文件删除失败或结果缺失')
      }
    } catch (error) { errors.push(error?.message || '云存储删除失败') }
  }
  const deletedFileIDs = source.filter(value => succeeded.has(fileID(value)))
  const failedFileIDs = source.filter(value => !succeeded.has(fileID(value)))
  return { deleted: succeeded.size, deletedFileIDs, failedFileIDs, error: [...new Set(errors)].join('; '), requestId: requestIds[0] || '', requestIds }
}
function hasFailure(row) {
  return ['code', 'errCode', 'status'].some(k => row[k] !== undefined && row[k] !== 0 && row[k] !== '0') || row.success === false
}

async function excludeReferencedFoodCovers(db, values) {
  const list = [...new Set(values.filter(isFoodCoverFile))], referenced = [], deletable = []
  const checked = new Map()
  for (const value of list) {
    const id = fileID(value)
    if (!checked.has(id)) {
      const forms = aliases(value)
      let used = false
      for (const [collection, field] of [['foods', 'cover_images'], ['foods', 'images'], ['uni-id-users', 'avatar']]) {
        const res = await db.collection(collection).where({ [field]: db.command.in(forms) }).limit(1).get()
        if (!Array.isArray(res?.data)) throw new Error('图片引用查询结果未确认')
        if (res.data.length) { used = true; break }
      }
      checked.set(id, used)
    }
    ;(checked.get(id) ? referenced : deletable).push(value)
  }
  return { referenced, deletable }
}
module.exports = { fileID, aliases, sameFile, isFoodCoverFile, isOwnedAvatarFile, deleteFiles, excludeReferencedFoodCovers }
