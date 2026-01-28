'use strict'
const db = uniCloud.database()

/**
 * ✅ 目标：
 * - foods.cover_images：数据库只存 fileID 数组（推荐）
 * - 接口返回：在原字段基础上额外带 cover_urls（临时可访问 URL 数组）
 *   （前端列表/详情直接用 cover_urls 展示，cover_images 用于保存/编辑）
 */

// 兼容：历史数据里如果 cover_images 里混了 http url，也允许继续展示
function splitCoverList(coverImages) {
  const arr = Array.isArray(coverImages) ? coverImages.filter(Boolean) : []
  const fileIDs = []
  const urls = []
  for (const x of arr) {
    const s = String(x)
    if (s.startsWith('http')) urls.push(s)
    else fileIDs.push(s)
  }
  return { fileIDs, urls }
}

async function fileIDsToTempUrls(fileIDs, maxAge = 60 * 60) {
  const ids = Array.isArray(fileIDs) ? fileIDs.filter(Boolean) : []
  if (!ids.length) return []

  // uniCloud 云对象里可以直接用 uniCloud.getTempFileURL
  const res = await uniCloud.getTempFileURL({
    fileList: ids.map((fileID) => ({ fileID, maxAge }))
  })

  // 按 fileIDs 的顺序输出 url（有些可能失败，给空串）
  const map = {}
  ;(res.fileList || []).forEach((it) => {
    if (it.fileID) map[it.fileID] = it.tempFileURL || ''
  })
  return ids.map((id) => map[id] || '')
}

async function attachCoverUrls(doc) {
  if (!doc) return doc

  const { fileIDs, urls: httpUrls } = splitCoverList(doc.cover_images)

  let tempUrls = []
  try {
    tempUrls = await fileIDsToTempUrls(fileIDs, 60 * 60) // 1小时
  } catch (e) {
    // 生成临时链接失败也不要让接口挂掉
    tempUrls = fileIDs.map(() => '')
  }

  // 最终展示用：http 旧数据 + fileID 临时链接（去掉空）
  const cover_urls = [...httpUrls, ...tempUrls].filter(Boolean)

  return {
    ...doc,
    cover_urls
  }
}

module.exports = {
  /**
   * 获取左侧一级分类（category表）
   */
  async getCategories() {
    const res = await db.collection('category')
      .where({ level: 0, deleted: false })
      .orderBy('sort', 'asc')
      .field({ cate_id: true, name: true, icon: true, sort: true, level: true, pid: true })
      .get()

    return res.data || []
  },

  /**
   * 获取右侧菜品列表（foods表）按 categoryId 过滤
   */
  async getFoodsByCategory(categoryId) {
    if (categoryId === undefined || categoryId === null) {
      throw new Error('categoryId 不能为空')
    }
  
    const cidStr = String(categoryId)
    const cidNum = Number(cidStr)
    const cmd = db.command
  
    const whereCond = Number.isFinite(cidNum)
      ? { categoryId: cmd.in([cidStr, cidNum]) } // ✅ 同时匹配 "3" 和 3
      : { categoryId: cidStr }                  // 非数字就只按字符串查
  
    const res = await db.collection('foods')
      .where(whereCond)
      .field({ name: true, cover_images: true, categoryId: true, foodId: true })
      .get()
  
    const list = res.data || []
    const out = []
    for (const item of list) {
      out.push(await attachCoverUrls(item))
    }
    return out
  },

  /**
   * 菜品详情：按 foods._id 查询一条
   */
  async getFoodDetail(id) {
    if (!id) throw new Error('id 不能为空')

    const res = await db.collection('foods').doc(id).get()
    const data = res.data && res.data[0]
    if (!data) throw new Error('菜品不存在')

    return await attachCoverUrls(data)
  },

  /**
   * 搜索菜品（按名称模糊匹配）
   */
  async searchFoods(keyword) {
    if (!keyword || !keyword.trim()) return []

    const reg = new RegExp(keyword.trim(), 'i')

    const res = await db.collection('foods')
      .where({ name: reg })
      .field({ name: true, cover_images: true, categoryId: true, foodId: true })
      .limit(50)
      .get()

    const list = res.data || []
    const out = []
    for (const item of list) {
      out.push(await attachCoverUrls(item))
    }
    return out
  },

  /**
   * 删除菜品：按 foods._id 删除
   */
  async deleteFood(id) {
    if (!id) throw new Error('id 不能为空')

    const foods = db.collection('foods')

    const old = await foods.doc(id).get()
    const doc = old.data && old.data[0]
    if (!doc) throw new Error('菜品不存在')

    await foods.doc(id).remove()
    return true
  },

  /**
   * 修改菜品：按 foods._id 更新
   */
  async updateFood(id, payload = {}) {
    if (!id) throw new Error('id 不能为空')

    const foods = db.collection('foods')

    const old = await foods.doc(id).get()
    const doc = old.data && old.data[0]
    if (!doc) throw new Error('菜品不存在')

    // foods 表的字段
    const allowFields = [
      'name',
      'categoryId',
      'categoryName',
      'cover_images',
      'price',
      'tags',
      'flavor',
      'difficulty',
      'cook_time',
      'summary',
      'ingredients',
      'steps'
    ]

    const updateData = {}
    for (const k of allowFields) {
      if (payload[k] !== undefined) updateData[k] = payload[k]
    }

    // ✅ 兜底：确保 cover_images 是数组
    if (updateData.cover_images !== undefined) {
      updateData.cover_images = Array.isArray(updateData.cover_images)
        ? updateData.cover_images.filter(Boolean)
        : []
    }

    await foods.doc(id).update(updateData)
    return true
  },

  /**
   * 新增菜品
   */
  async addFood(payload = {}) {
    const allowFields = [
      'name',
      'categoryId',
      'categoryName',
      'cover_images',
      'price',
      'tags',
      'flavor',
      'difficulty',
      'cook_time',
      'summary',
      'ingredients',
      'steps'
    ]

    const data = {}
    for (const k of allowFields) {
      if (payload[k] !== undefined) data[k] = payload[k]
    }

    // ✅ 兜底：确保 cover_images 是数组
    if (data.cover_images !== undefined) {
      data.cover_images = Array.isArray(data.cover_images)
        ? data.cover_images.filter(Boolean)
        : []
    } else {
      data.cover_images = []
    }

    // 云端生成业务 foodId（简单可用：时间戳）
    data.foodId = Date.now()

    const res = await db.collection('foods').add(data)
    return res.id || (res.result && res.result.id)
  }
}
