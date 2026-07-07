'use strict'
const db = uniCloud.database()
const uniID = require('uni-id-common')

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
  if (!token) throw new Error('未登录')

  const uniIdIns = getUniIdIns(ctx)
  const payload = await uniIdIns.checkToken(token)

  if (payload.code) {
    throw new Error(payload.msg || '未登录')
  }

  return payload.uid
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

  let urlMap = {}

  if (idArray.length) {
    try {
      const res = await uniCloud.getTempFileURL({
        fileList: idArray.map(id => ({ fileID: id, maxAge: 60 * 60 }))
      })

      ;(res.fileList || []).forEach(it => {
        if (it.fileID) urlMap[it.fileID] = it.tempFileURL || ''
      })
    } catch (e) {
      idArray.forEach(id => {
        urlMap[id] = ''
      })
    }
  }

  return docs.map(doc => {
    const { fileIDs, urls } = splitCoverList(doc.cover_images)

    const tempUrls = fileIDs.map(id => urlMap[id] || '')
    const cover_urls = [...urls, ...tempUrls].filter(Boolean)

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
  return list === undefined ? undefined : list
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

async function deleteCoverFiles(coverImages) {
  const { fileIDs } = splitCoverList(coverImages)
  const list = fileIDs.filter(id => id && id.startsWith('cloud://'))

  if (!list.length) return

  try {
    await uniCloud.deleteFile({ fileList: list })
  } catch (e) {
    console.error('delete cover files failed:', e)
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
      const uid = await requireLogin(this, token)
      const list = await getAdminUIDs()
      return list.includes(uid)
    } catch (e) {
      return false
    }
  },

  async getCategories() {
    const res = await db.collection('category')
      .where({ level: 0, deleted: false })
      .orderBy('sort', 'asc')
      .field({ cate_id: true, name: true, icon: true, sort: true })
      .get()

    return res.data || []
  },

  async getFoodsByCategory(categoryId) {
    if (categoryId === undefined || categoryId === null) {
      throw new Error('categoryId 不能为空')
    }

    const cidStr = String(categoryId)
    const cidNum = Number(cidStr)
    const cmd = db.command

    const whereCond = Number.isFinite(cidNum)
      ? { categoryId: cmd.in([cidStr, cidNum]) }
      : { categoryId: cidStr }

    const res = await db.collection('foods')
      .where(whereCond)
      .field({ name: true, cover_images: true, categoryId: true, foodId: true })
      .get()

    const list = res.data || []
    return await batchAttachCoverUrls(list)
  },

  async getFoodDetail(id) {
    if (!id) throw new Error('id 不能为空')

    const res = await db.collection('foods').doc(id).get()
    const data = res.data && res.data[0]
    if (!data) throw new Error('菜品不存在')

    return await attachCoverUrlsSingle(data)
  },

  async searchFoods(keyword) {
    if (!keyword || !keyword.trim()) return []

    const word = keyword.trim()
    if (word.length > 50) throw new Error('搜索关键词最长50字符')

    const reg = new RegExp(escapeRegExp(word), 'i')

    const res = await db.collection('foods')
      .where({ name: reg })
      .field({ name: true, cover_images: true, categoryId: true, foodId: true })
      .limit(50)
      .get()

    const list = res.data || []
    return await batchAttachCoverUrls(list)
  },

  async deleteFood(id, token) {
    if (!id) throw new Error('id 不能为空')

    const uid = await requireLogin(this, token)
    await requireAdmin(this, uid)

    const foods = db.collection('foods')
    const old = await foods.doc(id).get()
    const doc = old.data && old.data[0]
    if (!doc) throw new Error('菜品不存在')

    await foods.doc(id).remove()
    await deleteCoverFiles(doc.cover_images)
    return true
  },

  async updateFood(id, payload = {}, token) {
    if (!id) throw new Error('id 不能为空')

    const uid = await requireLogin(this, token)
    await requireAdmin(this, uid)

    const foods = db.collection('foods')
    const updateData = validateFoodPayload(payload, { partial: true })

    await foods.doc(id).update(updateData)
    return true
  },

  async addFood(payload = {}, token) {
    const uid = await requireLogin(this, token)
    await requireAdmin(this, uid)

    const data = validateFoodPayload(payload)
    if (!data.cover_images) data.cover_images = []

    data.foodId = Date.now() + '_' + Math.random().toString(16).slice(2)
    data.created_by = uid
    data.created_at = Date.now()

    const res = await db.collection('foods').add(data)
    return res.id || (res.result && res.result.id)
  }
}
