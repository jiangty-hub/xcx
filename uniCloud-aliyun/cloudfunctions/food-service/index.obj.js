'use strict'
const db = uniCloud.database()
const uniID = require('uni-id-common')
const STORAGE_FILE_BATCH_SIZE = 50
const MAX_COVER_IMAGES = 9

function chunkList(list, size = STORAGE_FILE_BATCH_SIZE) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

/**
 * =========================
 * 管理员配置（数据库版）
 * =========================
 */

let adminCache = {
  list: [],
  time: 0
}

// 60秒缓存
const ADMIN_CACHE_TTL = 60 * 1000

async function getAdminUIDs() {
  const now = Date.now()

  if (now - adminCache.time < ADMIN_CACHE_TTL && adminCache.list.length) {
    return adminCache.list
  }

  const res = await db.collection('app_settings').doc('admins').get()
  const data = res.data && res.data[0]

  const list = Array.isArray(data?.uids) ? data.uids : []

  adminCache = {
    list,
    time: now
  }

  return list
}

function getUniIdIns(ctx) {
  return uniID.createInstance({ clientInfo: ctx.getClientInfo() })
}

async function requireLogin(ctx, token) {
  if (!token) {
    const error = new Error('未登录')
    error.code = 401
    throw error
  }

  const uniIdIns = getUniIdIns(ctx)
  const payload = await uniIdIns.checkToken(token)

  if (payload.code) {
    const error = new Error(payload.msg || '未登录')
    error.code = 401
    throw error
  }

  return {
    uid: payload.uid,
    newToken: payload.token
      ? { token: payload.token, tokenExpired: payload.tokenExpired }
      : undefined,
    tokenExpired: payload.tokenExpired
  }
}

async function requireAdmin(ctx, uid) {
  const list = await getAdminUIDs()
  if (!uid || !list.includes(uid)) {
    throw new Error('无权限：仅管理员可操作')
  }
}

/**
 * =========================
 * 图片处理优化（批量版）
 * =========================
 */

function splitCoverList(arr) {
  const fileIDs = []
  const urls = []

  const list = Array.isArray(arr) ? arr : []

  for (const x of list) {
    const s = String(x)
    if (s.startsWith('http')) urls.push(s)
    else fileIDs.push(s)
  }

  return { fileIDs, urls }
}

async function batchAttachCoverUrls(docs) {
  if (!Array.isArray(docs) || !docs.length) return []

  const allFileIDs = new Set()

  docs.forEach(doc => {
    const { fileIDs } = splitCoverList(doc.cover_images)
    fileIDs.forEach(id => allFileIDs.add(id))
  })

  const idArray = Array.from(allFileIDs)

  const urlMap = {}

  if (idArray.length) {
    for (const batch of chunkList(idArray)) {
      try {
        const res = await uniCloud.getTempFileURL({
          fileList: batch
        })

        ;(res.fileList || []).forEach(it => {
          if (it.fileID) urlMap[it.fileID] = it.tempFileURL || ''
        })
      } catch (e) {
        console.error('get cover temp urls failed:', e)
        batch.forEach(id => {
          urlMap[id] = ''
        })
      }
    }
  }

  return docs.map(doc => {
    // 按 cover_images 的原始位置逐项换链，避免混合 URL 和 fileID 时封面顺序改变。
    const cover_urls = (Array.isArray(doc.cover_images) ? doc.cover_images : [])
      .map((item) => {
        const value = String(item)
        return value.startsWith('http') ? value : (urlMap[value] || '')
      })
      .filter(Boolean)

    return {
      ...doc,
      cover_urls
    }
  })
}

async function attachCoverUrlsSingle(doc) {
  const list = await batchAttachCoverUrls([doc])
  return list[0]
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeText(value, field, maxLength, required = false) {
  if (value === undefined) return undefined
  if (value === null) {
    if (required) throw new Error(`${field}不能为空`)
    return ''
  }

  const text = String(value).trim()
  if (required && !text) throw new Error(`${field}不能为空`)
  if (text.length > maxLength) throw new Error(`${field}最长${maxLength}字符`)
  return text
}

function normalizeNumber(value, field) {
  if (value === undefined) return undefined

  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`${field}不合法`)
  }

  return num
}

function normalizeStringArray(value, field, itemMaxLength = 80) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${field}必须是数组`)

  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => {
      if (item.length > itemMaxLength) throw new Error(`${field}单项最长${itemMaxLength}字符`)
      return item
    })
}

function normalizeCoverImages(value) {
  const list = normalizeStringArray(value, 'cover_images', 300)
  if (list === undefined) return undefined
  if (list.length > MAX_COVER_IMAGES) {
    throw new Error(`菜品图片最多${MAX_COVER_IMAGES}张`)
  }
  return list
}

function validateFoodPayload(payload = {}, { partial = false } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('菜品数据不合法')
  }

  const data = {}

  const name = normalizeText(payload.name, '菜名', 50, !partial || payload.name !== undefined)
  if (name !== undefined) data.name = name

  const categoryId = normalizeText(payload.categoryId, '菜品分类', 50, !partial || payload.categoryId !== undefined)
  if (categoryId !== undefined) data.categoryId = categoryId

  const categoryName = normalizeText(payload.categoryName, '分类名称', 50)
  if (categoryName !== undefined) data.categoryName = categoryName

  const coverImages = normalizeCoverImages(payload.cover_images)
  if (coverImages !== undefined) data.cover_images = coverImages

  const price = normalizeNumber(payload.price, '价格')
  if (price !== undefined) data.price = price

  const tags = normalizeStringArray(payload.tags, '标签', 30)
  if (tags !== undefined) data.tags = tags

  const flavor = normalizeText(payload.flavor, '口味', 50)
  if (flavor !== undefined) data.flavor = flavor

  const difficulty = normalizeText(payload.difficulty, '难度', 50)
  if (difficulty !== undefined) data.difficulty = difficulty

  const cookTime = normalizeNumber(payload.cook_time, '时长')
  if (cookTime !== undefined) data.cook_time = cookTime

  const summary = normalizeText(payload.summary, '菜品简介', 300)
  if (summary !== undefined) data.summary = summary

  const ingredients = normalizeStringArray(payload.ingredients, '食材清单', 80)
  if (ingredients !== undefined) data.ingredients = ingredients

  const steps = normalizeStringArray(payload.steps, '制作步骤', 300)
  if (steps !== undefined) data.steps = steps

  if (partial && !Object.keys(data).length) {
    throw new Error('没有可更新的字段')
  }

  return data
}

async function getActiveCategory(categoryId) {
  if (categoryId === undefined || categoryId === null || String(categoryId).trim() === '') {
    throw new Error('菜品分类不能为空')
  }

  const cidStr = String(categoryId).trim()
  const cidNum = Number(cidStr)
  const cateIdCondition = Number.isFinite(cidNum)
    ? db.command.in([cidStr, cidNum])
    : cidStr

  const res = await db.collection('category')
    .where({
      cate_id: cateIdCondition,
      level: 0,
      deleted: false
    })
    .field({ cate_id: true, name: true })
    .limit(1)
    .get()

  const category = res.data && res.data[0]
  if (!category) throw new Error('所选分类不存在或已停用')

  return category
}

async function attachVerifiedCategory(data) {
  if (data.categoryId === undefined) {
    if (data.categoryName !== undefined) {
      throw new Error('分类名称不能脱离分类ID单独更新')
    }
    return data
  }

  const category = await getActiveCategory(data.categoryId)
  data.categoryId = category.cate_id
  data.categoryName = String(category.name || '').trim()
  if (!data.categoryName) throw new Error('所选分类名称无效')
  return data
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

async function deleteCloudFiles(fileIDs, { foodOnly = false } = {}) {
  const source = Array.isArray(fileIDs) ? fileIDs : []
  const storageFiles = source.filter(id => typeof id === 'string' && (/^cloud:\/\//.test(id) || /^https?:\/\//i.test(id)))
  const filtered = foodOnly ? storageFiles.filter(isFoodCoverFile) : storageFiles
  const list = [...new Set(filtered)]
  const skipped = source.length - filtered.length

  if (!list.length) return { deleted: 0, skipped, error: '', failedFileIDs: [] }

  let deleted = 0
  const failedFileIDs = []
  const errors = []
  const requestIds = []

  for (const batch of chunkList(list)) {
    try {
      const res = await uniCloud.deleteFile({ fileList: batch })
      deleted += batch.length
      if (res?.requestId) requestIds.push(res.requestId)
    } catch (e) {
      console.error('delete cloud files failed:', e)
      failedFileIDs.push(...batch)
      errors.push(e?.message || '云存储删除失败')
    }
  }

  return {
    deleted,
    skipped,
    error: [...new Set(errors)].join('; '),
    failedFileIDs,
    requestId: requestIds[0] || '',
    requestIds
  }
}

async function enqueueFileCleanup(fileIDs, reason, error) {
  const list = [...new Set((Array.isArray(fileIDs) ? fileIDs : []).filter(isFoodCoverFile))]
  if (!list.length) return false

  const batches = chunkList(list)
  let queued = 0
  for (const batch of batches) {
    try {
      const now = Date.now()
      await db.collection('file_cleanup_tasks').add({
        taskType: 'food',
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
      console.error('enqueue file cleanup failed:', e)
    }
  }
  return queued === batches.length
}

async function excludeReferencedFoodCovers(fileIDs) {
  const list = [...new Set((Array.isArray(fileIDs) ? fileIDs : []).filter(isFoodCoverFile))]
  if (!list.length) return { deletable: [], referenced: [] }

  const referenced = new Set()
  const foods = db.collection('foods')

  for (const batch of chunkList(list)) {
    let offset = 0
    while (true) {
      const res = await foods
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

async function deleteCoverFiles(coverImages, reason) {
  const { fileIDs, urls } = splitCoverList(coverImages)
  const candidates = [...fileIDs, ...urls]
  const { deletable, referenced } = await excludeReferencedFoodCovers(candidates)
  const cleanup = await deleteCloudFiles(deletable, { foodOnly: true })
  cleanup.protectedFileIDs = referenced
  if (cleanup.error) {
    cleanup.queued = await enqueueFileCleanup(cleanup.failedFileIDs, reason, cleanup.error)
  }
  return cleanup
}

// 主记录已经写入/删除后，附件清理只能作为独立的后续步骤。
// 即使引用检查或云存储服务异常，也不能让客户端误以为主操作失败。
async function deleteCoverFilesAfterMutation(coverImages, reason) {
  try {
    return await deleteCoverFiles(coverImages, reason)
  } catch (e) {
    const source = Array.isArray(coverImages) ? coverImages : []
    const valid = source.filter(isFoodCoverFile)
    const candidates = [...new Set(valid)]
    const error = e?.message || '图片清理失败'

    console.error(`${reason} cleanup failed after mutation:`, e)

    // 延迟任务执行时会再次检查引用，因此可以安全地把原候选文件入队。
    const queued = await enqueueFileCleanup(candidates, reason, error)
    return {
      deleted: 0,
      skipped: source.length - valid.length,
      error,
      failedFileIDs: candidates,
      protectedFileIDs: [],
      queued,
      deferred: true
    }
  }
}

/**
 * =========================
 * 云对象接口
 * =========================
 */

module.exports = {

  async canManage(token) {
    try {
      const auth = await requireLogin(this, token)
      const list = await getAdminUIDs()
      return {
        canManage: list.includes(auth.uid),
        newToken: auth.newToken,
        tokenExpired: auth.tokenExpired
      }
    } catch (e) {
      const code = Number(e?.code) === 401 ? 401 : 500
      if (code === 500) console.error('check manage permission failed:', e)
      return {
        canManage: false,
        code,
        msg: code === 401 ? (e?.message || '未登录') : '权限校验失败，请稍后重试'
      }
    }
  },

  async getCategories() {
    const res = await db.collection('category')
      .where({ level: 0, deleted: false })
      .orderBy('sort', 'asc')
      .field({ _id: true, cate_id: true, name: true, icon: true, sort: true })
      .get()

    const list = Array.isArray(res.data) ? res.data : []
    return list.sort((left, right) => {
      const sortDiff = Number(left.sort || 0) - Number(right.sort || 0)
      if (sortDiff) return sortDiff
      return String(left._id || '').localeCompare(String(right._id || ''))
    })
  },

  async getFoodsByCategory(categoryId, options = {}) {
    if (categoryId === undefined || categoryId === null) {
      throw new Error('categoryId 不能为空')
    }

    const cidStr = String(categoryId)
    const cidNum = Number(cidStr)
    const cmd = db.command

    const whereCond = Number.isFinite(cidNum)
      ? { categoryId: cmd.in([cidStr, cidNum]) }
      : { categoryId: cidStr }

    const page = Math.max(1, Math.floor(Number(options.page) || 1))
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(options.pageSize) || 30)))

    const res = await db.collection('foods')
      .where(whereCond)
      .field({ name: true, cover_images: true, categoryId: true, foodId: true })
      .orderBy('name', 'asc')
      .orderBy('_id', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize + 1)
      .get()

    const rows = res.data || []
    const hasMore = rows.length > pageSize
    const list = await batchAttachCoverUrls(rows.slice(0, pageSize))
    return { list, hasMore, page, pageSize }
  },

  async getFoodDetail(id) {
    if (!id) throw new Error('id 不能为空')

    const res = await db.collection('foods').doc(id).get()
    const data = res.data && res.data[0]
    if (!data) throw new Error('菜品不存在')

    return await attachCoverUrlsSingle(data)
  },

  async searchFoods(keyword, options = {}) {
    const word = typeof keyword === 'string' ? keyword.trim() : ''
    const rawPage = Number(options && options.page)
    const rawPageSize = Number(options && options.pageSize)
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
    const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, 50)
      : 30

    if (!word) return { list: [], hasMore: false, page, pageSize }
    if (word.length > 50) throw new Error('搜索关键词最长50字符')

    const reg = new RegExp(escapeRegExp(word), 'i')

    const res = await db.collection('foods')
      .where({ name: reg })
      .field({ name: true, cover_images: true, categoryId: true, foodId: true })
      .orderBy('name', 'asc')
      .orderBy('_id', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize + 1)
      .get()

    const rows = Array.isArray(res.data) ? res.data : []
    const hasMore = rows.length > pageSize
    const list = await batchAttachCoverUrls(rows.slice(0, pageSize))
    return { list, hasMore, page, pageSize }
  },

  async deleteFood(id, token) {
    if (!id) throw new Error('id 不能为空')

    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)

    const foods = db.collection('foods')
    const old = await foods.doc(id).get()
    const doc = old.data && old.data[0]
    if (!doc) throw new Error('菜品不存在')

    await foods.doc(id).remove()
    const cleanup = await deleteCoverFilesAfterMutation(doc.cover_images, 'delete-food')
    return {
      deleted: true,
      cleanup,
      newToken: auth.newToken,
      tokenExpired: auth.tokenExpired
    }
  },

  async updateFood(id, payload = {}, token) {
    if (!id) throw new Error('id 不能为空')

    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)

    const foods = db.collection('foods')
    const updateData = validateFoodPayload(payload, { partial: true })
    await attachVerifiedCategory(updateData)
    const old = await foods.doc(id).get()
    const oldFood = old.data && old.data[0]
    if (!oldFood) throw new Error('菜品不存在')

    await foods.doc(id).update(updateData)

    // 图片先完成数据库更新，再清理本次被移除的旧文件，避免更新失败时误删图片。
    let cleanup = null
    if (updateData.cover_images !== undefined) {
      const next = new Set(updateData.cover_images)
      const removed = (Array.isArray(oldFood.cover_images) ? oldFood.cover_images : [])
        .filter(fileID => !next.has(fileID))
      cleanup = await deleteCoverFilesAfterMutation(removed, 'update-food')
      if (cleanup.error || cleanup.skipped) console.warn('update food cover cleanup incomplete:', cleanup)
    }
    return {
      updated: true,
      cleanup,
      newToken: auth.newToken,
      tokenExpired: auth.tokenExpired
    }
  },

  async cleanupUploadedCoverFiles(fileIDs, token) {
    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)
    const { deletable, referenced } = await excludeReferencedFoodCovers(fileIDs)
    const cleanup = await deleteCloudFiles(deletable, { foodOnly: true })
    cleanup.protectedFileIDs = referenced
    if (cleanup.error) {
      cleanup.queued = await enqueueFileCleanup(cleanup.failedFileIDs, 'abandon-upload', cleanup.error)
    }
    return {
      ...cleanup,
      newToken: auth.newToken,
      tokenExpired: auth.tokenExpired
    }
  },

  async addFood(payload = {}, token) {
    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)

    const data = validateFoodPayload(payload)
    await attachVerifiedCategory(data)
    if (!data.cover_images) data.cover_images = []

    data.foodId = Date.now() + '_' + Math.random().toString(16).slice(2)
    data.created_by = auth.uid
    data.created_at = Date.now()

    const res = await db.collection('foods').add(data)
    return {
      id: res.id || (res.result && res.result.id),
      newToken: auth.newToken,
      tokenExpired: auth.tokenExpired
    }
  }
}
