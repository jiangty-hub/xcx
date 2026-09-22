'use strict'
const { URL } = require('url')
const { createHash } = require('crypto')
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

// 本项目阿里云文件的实际地址；更换服务空间时需同步更新两个清理云函数。
const FOOD_STORAGE_HOST = 'mp-e3a48079-7f55-4c65-8f6c-9d757e567f86.cdn.bspapp.com'

function isFoodCoverFile(fileID) {
  if (typeof fileID !== 'string') return false
  if (fileID.startsWith('cloud://')) return fileID.includes('/foods/')

  try {
    const url = new URL(fileID)
    // 仅接受本空间的原始文件地址，避免临时签名或地址别名绕过引用检查。
    if (url.protocol !== 'https:' || url.hostname !== FOOD_STORAGE_HOST ||
        url.username || url.password || url.port || url.search || url.hash || url.href !== fileID) return false
    return /^\/(?:cloudstorage|foods)\/.+/.test(url.pathname) && !url.pathname.endsWith('/')
  } catch (e) {
    return false
  }
}

async function deleteCloudFiles(fileIDs, { foodOnly = false } = {}) {
  const source = Array.isArray(fileIDs) ? fileIDs : []
  const storageFiles = source.filter(id => typeof id === 'string' && (/^cloud:\/\//.test(id) || /^https?:\/\//i.test(id)))
  const filtered = foodOnly ? storageFiles.filter(isFoodCoverFile) : storageFiles
  const list = [...new Set(filtered)]
  const skipped = source.length - filtered.length

  if (!list.length) return { deleted: 0, deletedFileIDs: [], skipped, error: '', failedFileIDs: [] }

  let deleted = 0
  const deletedFileIDs = []
  const failedFileIDs = []
  const errors = []
  const requestIds = []

  for (const batch of chunkList(list)) {
    try {
      const res = await uniCloud.deleteFile({ fileList: batch })
      deleted += batch.length
      deletedFileIDs.push(...batch)
      if (res?.requestId) requestIds.push(res.requestId)
    } catch (e) {
      console.error('delete cloud files failed:', e)
      failedFileIDs.push(...batch)
      errors.push(e?.message || '云存储删除失败')
    }
  }

  return {
    deleted,
    deletedFileIDs,
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

    // cloudstorage 同时存放菜品和头像，清理前也保护用户当前使用的头像。
    let userOffset = 0
    while (true) {
      const res = await db.collection('uni-id-users')
        .where({ avatar: db.command.in(batch) })
        .field({ avatar: true })
        .skip(userOffset)
        .limit(100)
        .get()
      const users = res.data || []
      users.forEach((user) => {
        if (batch.includes(user.avatar)) referenced.add(user.avatar)
      })
      if (users.length < 100) break
      userOffset += users.length
    }
  }

  return {
    deletable: list.filter((fileID) => !referenced.has(fileID)),
    referenced: list.filter((fileID) => referenced.has(fileID))
  }
}

async function deleteCoverFiles(coverImages, reason) {
  const candidates = [...new Set((Array.isArray(coverImages) ? coverImages : [])
    .filter((id) => typeof id === 'string' && id))]
  const skippedFileIDs = candidates.filter((id) => !isFoodCoverFile(id))
  const { deletable, referenced } = await excludeReferencedFoodCovers(candidates)
  const cleanup = await deleteCloudFiles(deletable, { foodOnly: true })
  cleanup.protectedFileIDs = referenced
  cleanup.skippedFileIDs = skippedFileIDs
  cleanup.skipped = skippedFileIDs.length
  cleanup.skipReason = skippedFileIDs.length ? '不是本项目支持的菜品图片地址' : ''
  if (cleanup.error) {
    cleanup.queued = await enqueueFileCleanup(cleanup.failedFileIDs, reason, cleanup.error)
  }
  // 客户端只移除明确完成、受引用保护或已由云端接管重试的待清理记录。
  cleanup.confirmedFileIDs = [...cleanup.deletedFileIDs, ...referenced,
    ...(cleanup.queued ? cleanup.failedFileIDs : [])]
  if (cleanup.error || cleanup.skipped) console.warn(reason + ' cover cleanup incomplete:', cleanup)
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
      deletedFileIDs: [],
      confirmedFileIDs: queued ? candidates : [],
      skippedFileIDs: source.filter((id) => !isFoodCoverFile(id)),
      skipReason: source.length > valid.length ? '不是本项目支持的菜品图片地址' : '',
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

  async updateFood(id, payload = {}, token, expectedVersion, requestId) {
    // 旧版没有持久化保护记录，不能继续走可能与清理竞态的写入路径。
    return module.exports.updateFoodOnce.call(this, id, payload, token, expectedVersion, requestId)
  },

  async updateFoodOnce(id, payload = {}, token, expectedVersion, requestId) {
    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)
    const authResult = { newToken: auth.newToken, tokenExpired: auth.tokenExpired }
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) {
      return { code: 426, updated: false, msg: '请更新小程序后再修改菜品', ...authResult }
    }
    if (typeof id !== 'string' || !id) throw new Error('id 不能为空')
    const requestKey = createHash('sha256').update(JSON.stringify([auth.uid, requestId])).digest('hex')
    // 包括目标菜品和原版本；重试必须使用持久化的原始提交内容。
    const payloadHash = createHash('sha256').update(JSON.stringify([id, expectedVersion, payload])).digest('hex')
    const requests = db.collection('food_edit_requests')
    const asResult = (record, replayed) => ({
      code: record.resultCode, updated: record.resultCode === 0, terminal: true,
      version: record.version, msg: record.message, replayed, ...authResult
    })
    const readSaved = async () => {
      const res = await requests.doc(requestKey).get()
      const record = res.data && res.data[0]
      if (!record) return null
      if (record.ownerUid !== auth.uid || record.payloadHash !== payloadHash) {
        // 不是本次内容的最终结果，客户端必须继续保护图片。
        return { code: 409, terminal: false, updated: false, msg: '提交内容不一致，请重新进入编辑页确认原修改', ...authResult }
      }
      return asResult(record, true)
    }
    const saved = await readSaved()
    if (saved) return saved

    let updateData = {}
    let rejection = ''
    try {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
        throw new Error('缺少有效的菜品版本，请重新打开编辑页')
      }
      updateData = validateFoodPayload(payload, { partial: true })
    } catch (error) {
      rejection = error.message || '菜品数据不合法'
    }
    if (!rejection) {
      try {
        await attachVerifiedCategory(updateData)
      } catch (error) {
        if (['所选分类不存在或已停用', '所选分类名称无效', '菜品分类不能为空'].includes(error.message)) rejection = error.message
        else throw error
      }
    }

    const transaction = await db.startTransaction()
    let result
    try {
      const record = {
        _id: requestKey, ownerUid: auth.uid, foodId: id, payloadHash,
        resultCode: rejection ? 400 : 0, message: rejection, createdAt: Date.now()
      }
      if (!rejection) {
        // 阿里云事务仅用 doc 读写单条记录；读版本和写菜品处于同一事务。
        const old = await transaction.collection('foods').doc(id).get()
        const oldFood = Array.isArray(old.data) ? old.data[0] : old.data
        if (!oldFood || (oldFood.version === undefined ? 0 : oldFood.version) !== expectedVersion) {
          record.resultCode = 409
          record.message = '菜品已被修改或删除，本次修改未保存。请先保留需要的内容，再重新打开编辑页。'
        } else {
          updateData.version = expectedVersion + 1
          const changed = await transaction.collection('foods').doc(id).update(updateData)
          if (changed.updated !== 1) throw new Error('保存结果尚未确认，请重试确认')
          record.version = updateData.version
          const next = new Set(updateData.cover_images || [])
          const removed = updateData.cover_images === undefined ? [] :
            (Array.isArray(oldFood.cover_images) ? oldFood.cover_images : []).filter(fileID => !next.has(fileID) && isFoodCoverFile(fileID))
          if (removed.length) {
            // 旧图片清理任务也随保存提交；提交确认丢失仍不会漏掉清理任务。
            await transaction.collection('file_cleanup_tasks').add({
              taskType: 'food', fileIDs: removed, reason: 'update-food', status: 'pending',
              attempts: 0, createdAt: Date.now(), updatedAt: Date.now()
            })
          }
        }
      }
      // 明确拒绝同样写入终态，阻止同编号的迟到请求再次保存。
      await transaction.collection('food_edit_requests').add(record)
      await transaction.commit()
      result = asResult(record, false)
    } catch (error) {
      try { await transaction.rollback() } catch (rollbackError) {
        console.warn('edit food rollback not confirmed:', rollbackError)
      }
      const recovered = await readSaved()
      if (recovered) return recovered
      throw error
    }
    return result
  },

  async cleanupUploadedCoverFiles(fileIDs, token) {
    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)
    const cleanup = await deleteCoverFiles(fileIDs, 'abandon-upload')
    return {
      ...cleanup,
      newToken: auth.newToken,
      tokenExpired: auth.tokenExpired
    }
  },

  // 旧客户端不能回退到无去重的新增逻辑；已有菜品读写不受影响。
  async addFood(payload, token, requestId) {
    return module.exports.addFoodOnce.call(this, payload, token, requestId)
  },

  async addFoodOnce(payload = {}, token, requestId) {
    const auth = await requireLogin(this, token)
    await requireAdmin(this, auth.uid)
    const authResult = { newToken: auth.newToken, tokenExpired: auth.tokenExpired }
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) {
      return { code: 426, msg: '请更新小程序后再新增菜品', ...authResult }
    }

    let data
    try {
      data = validateFoodPayload(payload)
      if (!data.name || data.categoryId === undefined || data.categoryId === '') {
        throw new Error('请填写菜名并选择分类')
      }
    } catch (error) {
      return { code: 400, msg: error.message || '菜品数据不合法', ...authResult }
    }
    const requestKey = createHash('sha256').update(JSON.stringify([auth.uid, requestId])).digest('hex')
    // 固定字段顺序的校验结果用于比对；分类名称核对前计算，避免分类改名影响重试。
    const payloadHash = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    const requests = db.collection('food_create_requests')
    const readSaved = async () => {
      const res = await requests.doc(requestKey).get()
      const saved = res.data && res.data[0]
      if (!saved) return null
      if (saved.ownerUid !== auth.uid || saved.payloadHash !== payloadHash) {
        return { code: 409, msg: '该次提交内容不一致，请保留当前内容后核对已发布菜品', ...authResult }
      }
      if (saved.resultCode === 400) return { code: 400, msg: saved.message, ...authResult }
      // 菜品后来被编辑/删除时仍返回原提交结果，绝不重新创建或覆盖菜品。
      return { code: 0, id: saved.foodId, replayed: true, ...authResult }
    }
    const saved = await readSaved()
    if (saved) return saved

    // 分类状态可能变化，明确拒绝也要留下终态，避免与尚在处理的同编号请求竞态。
    let rejectionMessage = ''
    try {
      await attachVerifiedCategory(data)
    } catch (error) {
      if (['所选分类不存在或已停用', '所选分类名称无效', '菜品分类不能为空'].includes(error.message)) {
        rejectionMessage = error.message
      } else throw error
    }
    if (!data.cover_images) data.cover_images = []
    data.foodId = Date.now() + '_' + Math.random().toString(16).slice(2)
    data.version = 1
    data.created_by = auth.uid
    data.created_at = Date.now()

    const transaction = await db.startTransaction()
    try {
      if (rejectionMessage) {
        await transaction.collection('food_create_requests').add({
          _id: requestKey, ownerUid: auth.uid, payloadHash, foodId: '',
          resultCode: 400, message: rejectionMessage, createdAt: Date.now()
        })
        await transaction.commit()
        return { code: 400, msg: rejectionMessage, ...authResult }
      }
      const added = await transaction.collection('foods').add(data)
      const id = added.id || added.result?.id
      if (!id) throw new Error('新增返回结果异常')
      // _id 自带唯一性；并发请求冲突时，整笔事务（包括菜品）一起回滚。
      await transaction.collection('food_create_requests').add({
        _id: requestKey,
        ownerUid: auth.uid,
        payloadHash,
        foodId: id,
        resultCode: 0,
        createdAt: Date.now()
      })
      await transaction.commit()
      return { code: 0, id, replayed: false, ...authResult }
    } catch (error) {
      try { await transaction.rollback() } catch (rollbackError) {
        console.warn('create food rollback not confirmed:', rollbackError)
      }
      // 包括“提交已成功但确认丢失”；只在读到已完成记录时报告成功。
      const recovered = await readSaved()
      if (recovered) return recovered
      throw error
    }
  }
}
