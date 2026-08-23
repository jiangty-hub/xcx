const STORAGE_KEYS = {
  food: 'pending_food_cover_cleanup',
  avatar: 'pending_avatar_cleanup'
}

function storageKey(type) {
  if (typeof type === 'string' && type.startsWith('avatar:')) {
    const uid = type.slice('avatar:'.length)
    if (uid) return `${STORAGE_KEYS.avatar}_${uid}`
  }
  const key = STORAGE_KEYS[type]
  if (!key) throw new Error(`未知清理类型：${type}`)
  return key
}

function normalizeIDs(value) {
  let list = value
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list)
    } catch (e) {
      list = []
    }
  }

  return [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && id))]
}

export function getPendingCleanup(type) {
  return normalizeIDs(uni.getStorageSync(storageKey(type)))
}

export function addPendingCleanup(type, fileIDs) {
  const next = normalizeIDs([...getPendingCleanup(type), ...normalizeIDs(fileIDs)])
  uni.setStorageSync(storageKey(type), next)
  return next
}

export function removePendingCleanup(type, fileIDs) {
  const removed = new Set(normalizeIDs(fileIDs))
  const next = getPendingCleanup(type).filter((id) => !removed.has(id))
  if (next.length) uni.setStorageSync(storageKey(type), next)
  else uni.removeStorageSync(storageKey(type))
  return next
}
