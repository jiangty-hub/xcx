const STORAGE_KEY = 'pending_food_creates_v1'

function readRequests() {
  const raw = uni.getStorageSync(STORAGE_KEY)
  if (!raw) return {}
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('待确认发布记录异常，请先核对已发布菜品')
  }
  return value
}

export function getFoodCreateRequest(uid) {
  return uid ? (readRequests()[uid] || null) : null
}

export function saveFoodCreateRequest(uid, request) {
  if (!uid || !request?.requestId || !request.payload) throw new Error('缺少发布记录信息')
  const all = readRequests()
  // 不覆盖同一账号尚未确认的其他发布。
  if (all[uid] && all[uid].requestId !== request.requestId) {
    throw new Error('还有一次发布尚未确认，请重新进入新增页继续确认')
  }
  all[uid] = JSON.parse(JSON.stringify(request))
  uni.setStorageSync(STORAGE_KEY, all)
}

export function clearFoodCreateRequest(uid, requestId) {
  const all = readRequests()
  if (all[uid]?.requestId !== requestId) return
  delete all[uid]
  if (Object.keys(all).length) uni.setStorageSync(STORAGE_KEY, all)
  else uni.removeStorageSync(STORAGE_KEY)
}

export function getProtectedCreateCovers() {
  return [...new Set(Object.values(readRequests()).flatMap(request =>
    Array.isArray(request?.payload?.cover_images) ? request.payload.cover_images : []
  ))]
}

export function newFoodCreateId() {
  return 'fc_' + Date.now().toString(36) + '_' +
    Math.random().toString(36).slice(2).padEnd(10, '0') +
    Math.random().toString(36).slice(2).padEnd(10, '0')
}
