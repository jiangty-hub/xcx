const STORAGE_KEY = 'pending_food_edits_v1'

function readRequests() {
  const raw = uni.getStorageSync(STORAGE_KEY)
  if (!raw) return {}
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('待确认修改记录异常，请先核对菜品保存结果')
  }
  // 记录损坏时停止清理，不能把无法读取的保护记录当成没有记录。
  for (const request of Object.values(value)) {
    if (!request?.requestId || !request.payload || !Array.isArray(request.payload.cover_images)) {
      throw new Error('待确认修改记录异常，请先核对菜品保存结果')
    }
  }
  return value
}

function key(uid, foodId) {
  return JSON.stringify([uid, foodId])
}

export function getFoodEditRequest(uid, foodId) {
  return uid && foodId ? readRequests()[key(uid, foodId)] || null : null
}

export function saveFoodEditRequest(uid, foodId, request) {
  if (!uid || !foodId || !request?.requestId || !Array.isArray(request.payload?.cover_images)) {
    throw new Error('缺少修改记录信息')
  }
  const all = readRequests()
  const id = key(uid, foodId)
  if (all[id] && all[id].requestId !== request.requestId) {
    throw new Error('该菜品还有一次修改尚未确认，请重新进入编辑页')
  }
  all[id] = JSON.parse(JSON.stringify(request))
  uni.setStorageSync(STORAGE_KEY, all)
}

export function clearFoodEditRequest(uid, foodId, requestId) {
  const all = readRequests()
  const id = key(uid, foodId)
  if (all[id]?.requestId !== requestId) return
  delete all[id]
  if (Object.keys(all).length) uni.setStorageSync(STORAGE_KEY, all)
  else uni.removeStorageSync(STORAGE_KEY)
}

export function getProtectedEditCovers() {
  return [...new Set(Object.values(readRequests()).flatMap(request => request.payload.cover_images))]
}
