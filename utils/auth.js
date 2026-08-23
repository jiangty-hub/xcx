export function getAuthToken() {
  return (
    uni.getStorageSync('uni_id_token') ||
    uni.getStorageSync('uniIdToken') ||
    uni.getStorageSync('token') ||
    ''
  )
}

export function applyNewToken(result) {
  if (!result || typeof result !== 'object') return ''

  const renewal = result.newToken
  const token = (
    (renewal && typeof renewal === 'object' ? renewal.token : renewal) ||
    result.token ||
    ''
  )
  if (!token) return ''

  uni.setStorageSync('uni_id_token', token)

  const expired = (
    (renewal && typeof renewal === 'object' ? renewal.tokenExpired : undefined) ??
    result.tokenExpired ??
    result.newTokenExpired
  )
  if (expired !== undefined && expired !== null) {
    uni.setStorageSync('uni_id_token_expired', expired)
  }

  return token
}

export function isAuthExpiredResult(result) {
  const code = Number(result?.code)
  const msg = String(result?.msg || '')
  if (code === 401) return true
  return /token|未登录|登录|失效|过期|unauth|auth/i.test(msg)
}

export async function checkManagePermission(foodService, token = getAuthToken()) {
  if (!token) {
    return { canManage: false, authExpired: true, missingToken: true, result: null }
  }
  if (!foodService || typeof foodService.canManage !== 'function') {
    throw new Error('权限服务不可用')
  }

  const result = await foodService.canManage(token)
  applyNewToken(result)

  if (isAuthExpiredResult(result)) {
    return { canManage: false, authExpired: true, missingToken: false, result }
  }

  const code = Number(result?.code || 0)
  if (code) throw new Error(result?.msg || '权限校验失败')

  return {
    canManage: typeof result === 'boolean' ? result : !!result?.canManage,
    authExpired: false,
    missingToken: false,
    result
  }
}

export async function resolveCloudFileToUrl(value) {
  if (!value) return ''
  const file = String(value)
  if (/^https?:\/\//i.test(file)) return file
  if (!/^cloud:\/\//i.test(file)) return ''

  try {
    const result = await uniCloud.getTempFileURL({ fileList: [file] })
    return result.fileList?.[0]?.tempFileURL || ''
  } catch (error) {
    console.log('getTempFileURL failed:', error)
    return ''
  }
}

export function clearAuthStorage() {
  ;[
    'uni_id_token',
    'uni_id_token_expired',
    'uni_id_uid',
    'uniIdToken',
    'token',
    'uni_id_nickname',
    'uni_id_avatar'
  ].forEach((key) => uni.removeStorageSync(key))
}
