<template>
  <view class="page">
    <view class="header">
      <text class="title">{{ mode === 'edit' ? '修改菜品' : '新增菜品' }}</text>
    </view>

    <view class="content">
      <view v-if="pendingCreate" class="card">
        <text>发布结果待确认，请点击底部“重试确认”。确认完成前暂不能修改内容，离开后可再次进入继续确认。</text>
      </view>
      <view v-if="pendingEdit" class="card">
        <text>修改结果待确认，请点击底部“重试确认”。确认前暂不能修改内容，离开后可重新进入此菜品编辑页继续确认。</text>
      </view>
      <!-- 基础信息 -->
      <view class="card">
        <view class="row">
          <text class="label">菜名</text>
          <input :disabled="formLocked" class="input" v-model="form.name" placeholder="例如：麻婆豆腐" />
        </view>

        <view class="row">
          <text class="label">价格</text>
          <input :disabled="formLocked" class="input" type="number" v-model="form.price" placeholder="例如：880" />
        </view>

        <view class="row">
          <text class="label">菜品分类</text>
          <picker :disabled="formLocked" class="picker" :range="cateList" range-key="name" :value="cateIndex" @change="onCateChange">
            <view class="picker-view">
              <text v-if="cateIndex !== -1">{{ cateList[cateIndex].name }}</text>
              <text v-else class="placeholder">请选择分类</text>
            </view>
          </picker>
        </view>

        <view class="row">
          <text class="label">口味</text>
          <input :disabled="formLocked" class="input" v-model="form.flavor" placeholder="例如：咸香微辣/酸甜可口" />
        </view>

        <view class="row">
          <text class="label">难度</text>
          <input :disabled="formLocked" class="input" v-model="form.difficulty" placeholder="例如：简单/中等/困难" />
        </view>

        <view class="row">
          <text class="label">时长(分)</text>
          <input :disabled="formLocked" class="input" type="number" v-model="form.cook_time" placeholder="例如：10" />
        </view>

        <view class="row col">
          <text class="label">菜品简介</text>
          <textarea :disabled="formLocked" class="textarea" v-model="form.summary" placeholder="一句话介绍菜品" />
        </view>
      </view>

      <!-- 封面图（✅ 存 fileID，展示用临时 URL） -->
      <view class="card">
        <view class="section-title">菜品图片（{{ form.cover_images.length }}/{{ maxCoverImages }}）</view>

        <view class="img-list" v-if="form.cover_images.length">
          <view class="img-item" v-for="(fid, idx) in form.cover_images" :key="idx">
            <image class="img" :src="coverSrc(fid)" mode="aspectFill" />
            <view class="img-actions">
              <view class="mini-btn mini-danger" @click="removeCover(idx)">删除</view>
            </view>
          </view>
        </view>

        <view class="row">
          <view
            class="btn small btn-add"
            :class="{ disabled: formLocked || !canManage || form.cover_images.length >= maxCoverImages }"
            @click="chooseAndUploadCover('album')"
          >
            {{ uploading ? '上传中...' : (form.cover_images.length >= maxCoverImages ? '已达图片上限' : '从相册选择') }}
          </view>
          <view
            class="btn small btn-add"
            :class="{ disabled: formLocked || !canManage || form.cover_images.length >= maxCoverImages }"
            @click="chooseAndUploadCover('camera')"
          >
            {{ uploading ? '上传中...' : (form.cover_images.length >= maxCoverImages ? '已达图片上限' : '拍照上传') }}
          </view>
        </view>

        <view class="row" v-if="uploading">
          <text class="label">上传进度</text>
          <text class="placeholder">{{ uploadProgress }}%</text>
        </view>

        <view class="row" v-if="!canManage">
          <text class="placeholder">登录管理员账号后才可上传/编辑</text>
        </view>
      </view>

      <!-- tags -->
      <view class="card">
        <view class="section-title">标签</view>

        <view class="row split">
          <input :disabled="formLocked" class="input grow" v-model="tagInput" placeholder="例如：下饭/好吃" />
          <view class="btn small btn-add shrink" :class="{ disabled: formLocked || !canManage }" @click="addTag">添加</view>
        </view>

        <view class="chips" v-if="form.tags.length">
          <view class="chip" v-for="(t, i) in form.tags" :key="i">
            <text class="chip-text">{{ t }}</text>
            <view class="chip-x" @click="removeTag(i)">×</view>
          </view>
        </view>
      </view>

      <!-- ingredients -->
      <view class="card">
        <view class="section-title">食材清单</view>

        <view class="row split">
          <input :disabled="formLocked" class="input grow" v-model="ingInput" placeholder="例如：肥牛/猪肉" />
          <view class="btn small btn-add shrink" :class="{ disabled: formLocked || !canManage }" @click="addIngredient">添加</view>
        </view>

        <view class="list" v-if="form.ingredients.length">
          <view class="list-item" v-for="(it, i) in form.ingredients" :key="i">
            <text class="li-text">{{ i + 1 }}. {{ it }}</text>
            <view class="mini-btn mini-danger" @click="removeIngredient(i)">删除</view>
          </view>
        </view>
      </view>

      <!-- steps -->
      <view class="card">
        <view class="section-title">制作步骤</view>

        <view class="row split">
          <input :disabled="formLocked" class="input grow" v-model="stepInput" placeholder="例如：猪肉焯水..." />
          <view class="btn small btn-add shrink" :class="{ disabled: formLocked || !canManage }" @click="addStep">添加</view>
        </view>

        <view class="list" v-if="form.steps.length">
          <view class="list-item" v-for="(it, i) in form.steps" :key="i">
            <text class="li-text">{{ i + 1 }}. {{ it }}</text>
            <view class="mini-btn mini-danger" @click="removeStep(i)">删除</view>
          </view>
        </view>
      </view>
    </view>

    <!-- ✅ 底部按钮：固定 -->
    <view class="bottom">
      <view class="btn ghost" @click="onCancel">取消</view>
      <view class="btn primary" :class="{ disabled: submitting || uploading || createInitializing || leaveGuardLeaving || !canManage }" @click="onSubmit">
        {{ submitting ? '提交中...' : ((pendingEdit || pendingCreate) ? '重试确认' : (mode === 'edit' ? '保存修改' : '发布菜品')) }}
      </view>
    </view>
  </view>
</template>

<script>
import { beginLoading } from '@/utils/loading.js'
import leaveGuard from '@/utils/leave-guard.js'
import { getFoodCreateRequest, saveFoodCreateRequest, clearFoodCreateRequest, getProtectedCreateCovers, newFoodCreateId } from '@/utils/food-create-request.js'
import { getFoodEditRequest, saveFoodEditRequest, clearFoodEditRequest, getProtectedEditCovers } from '@/utils/food-edit-request.js'
import { applyNewToken, checkManagePermission, getAuthToken } from '@/utils/auth.js'
import { addPendingCleanup, getPendingCleanup, removePendingCleanup } from '@/utils/pending-cleanup.js'

const foodService = uniCloud.importObject('food-service', { customUI: true })
const STORAGE_FILE_BATCH_SIZE = 50
const MAX_COVER_IMAGES = 9

function chunkList(list, size = STORAGE_FILE_BATCH_SIZE) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

export default {
  mixins: [leaveGuard],

  computed: {
    formLocked() {
      return this.createInitializing || this.submitting || this.uploading ||
        this.leaveGuardLeaving || !!this.pendingCreate || !!this.pendingEdit
    },
    leaveGuardMessage() {
      if (this.submitting) return '正在保存，离开后请确认保存结果。'
      if (this.uploading) return '图片上传中，离开可能丢失本次上传。'
      if (this.pendingCreate) return '发布结果尚未确认，离开后可再次进入新增页继续确认。'
      if (this.pendingEdit) return '修改结果尚未确认，离开后可重新进入此菜品编辑页继续确认。'
      const hasDraft = [this.tagInput, this.ingInput, this.stepInput].some(value => String(value || '').trim())
      return (hasDraft || (this.snapshot && this.isDirty()))
        ? '内容尚未保存，离开将丢失本次修改。' : ''
    }
  },

  data() {
    return {
      mode: 'add',
      createInitializing: true,
      createOwnerUid: '',
      createRequestId: '',
      pendingCreate: null,
      pendingEdit: null,
      foodId: '',
      foodVersion: null,
      submitting: false,
      cateList: [],
      cateIndex: -1,

      // ✅ 权限
      canManage: false,

      // 图片：数据库存 fileID；页面展示用临时 URL 缓存
      maxCoverImages: MAX_COVER_IMAGES,
      coverUrlMap: {},
      newlyUploadedCoverIds: [],
      uploading: false,
      uploadProgress: 0,
      uploadTimer: null,
      hasRealTotal: false,

      backLock: false,

      // 本页面持有的加载任务；每个任务只关闭一次
      loadingStops: [],

      form: {
        foodId: '',
        name: '',
        categoryId: '',
        categoryName: '',
        cover_images: [],
        price: 0,
        tags: [],
        flavor: '',
        difficulty: '',
        cook_time: 0,
        summary: '',
        ingredients: [],
        steps: []
      },

      tagInput: '',
      ingInput: '',
      stepInput: '',

      snapshot: ''
    }
  },

  async onLoad(options) {
    this.mode = options.mode || 'add'
    this.foodId = options.id || ''

    await this.loadCategories()

    // ✅ 先判断权限（没权限也可以看页面，但不能提交/上传）
    await this.refreshPermission()
    if (this.canManage) {
      this.createOwnerUid = uni.getStorageSync('uni_id_uid') || ''
      if (this.mode === 'edit') {
        try {
          this.pendingEdit = getFoodEditRequest(this.createOwnerUid, this.foodId)
          if (this.pendingEdit) {
            this.form = { ...this.form, ...JSON.parse(JSON.stringify(this.pendingEdit.payload)) }
            this.foodVersion = this.pendingEdit.expectedVersion
          }
        } catch (error) {
          uni.showToast({ title: error.message || '读取待确认修改失败', icon: 'none' })
          return
        }
      }
      if (this.mode !== 'edit') {
        try {
          this.pendingCreate = getFoodCreateRequest(this.createOwnerUid)
          if (this.pendingCreate) {
            this.createRequestId = this.pendingCreate.requestId
            this.form = { ...this.form, ...this.pendingCreate.payload }
          }
        } catch (error) {
          uni.showToast({ title: error.message || '读取待确认发布失败', icon: 'none' })
          return
        }
      }
      this.newlyUploadedCoverIds = [...new Set([...getPendingCleanup('food'), ...(this.pendingCreate?.uploadedCoverIds || []), ...(this.pendingEdit?.uploadedCoverIds || [])])]
      await this.cleanupPendingCovers()
    }

    if (this.mode === 'edit') {
      if (!this.foodId) {
        uni.showToast({ title: '缺少菜品id', icon: 'none' })
        uni.navigateBack()
        return
      }
      const loaded = this.pendingEdit ? true : await this.loadForEdit()
      if (!loaded) return
      this.syncCateIndexByForm()
      await this.hydrateCoverUrls()
    } else if (this.pendingCreate) {
      this.syncCateIndexByForm()
      await this.hydrateCoverUrls()
    } else {
      if (this.cateList.length) {
        this.cateIndex = 0
        this.form.categoryId = this.cateList[0].cate_id
        this.form.categoryName = this.cateList[0].name
      }
    }

    this.snapshot = JSON.stringify(this.normalizeForm(this.form))
    this.createInitializing = false
  },

  // 页面离开兜底：提交/上传进行中时只保留待清理记录，避免与写库请求并发删除图片。
  onUnload() {
    this.safeHideLoading(true)
    this.stopFakeProgress()
    if (!this.submitting && !this.uploading) {
      this.cleanupPendingCovers()
    }
  },

  onBackPress() {
    if (this.leaveGuardLeaving) return false
    if (this.submitting || this.uploading) {
      return true
    }
    if (this.backLock) return true
    if (this.isDirty()) {
      this.backLock = true
      uni.showModal({
        title: '提示',
        content: this.pendingEdit ? '修改结果尚未确认，离开后可重新进入此菜品编辑页继续确认。' : (this.pendingCreate ? '发布结果尚未确认，离开后可再次进入新增页继续确认。' : '内容尚未保存，确定要离开吗？'),
        success: async (res) => {
          if (res.confirm) {
            await this.leaveWithCleanup()
          } else {
            this.backLock = false
          }
        },
        fail: () => {
          this.backLock = false
        }
      })
      return true
    }
    return false
  },

  methods: {
    // ✅ 统一取 token：兼容不同项目里存 token 的 key
    getToken() {
      return getAuthToken()
    },

    // ✅ 校验权限（token 有效且 uid 在管理员白名单）
    async refreshPermission() {
      const token = this.getToken()
      if (!token) {
        this.canManage = false
        return
      }
      try {
        const permission = await checkManagePermission(foodService, token)
        this.canManage = permission.canManage
      } catch (e) {
        this.canManage = false
        console.error('permission check failed:', e)
        uni.showToast({ title: e?.message || '权限校验失败，请稍后重试', icon: 'none' })
      }
    },

    safeShowLoading(title = '加载中...') {
      this.loadingStops.push(beginLoading(title))
    },

    async safeHideLoading(force = false) {
      const stops = force ? this.loadingStops.splice(0) : this.loadingStops.splice(-1)
      await Promise.all(stops.map(stop => stop()))
    },

    async loadCategories() {
      try {
        const list = await foodService.getCategories()
        this.cateList = list || []
      } catch (e) {
        uni.showToast({ title: e?.message || '分类加载失败', icon: 'none' })
        this.cateList = []
      }
    },

    async loadForEdit() {
      this.safeShowLoading('加载中...')
      try {
        const dish = await foodService.getFoodDetail(this.foodId)
        this.foodVersion = dish.version === undefined ? 0 : dish.version

        this.form = {
          ...this.form,
          foodId: dish.foodId ?? '',
          name: dish.name ?? '',
          categoryId: dish.categoryId ?? '',
          categoryName: dish.categoryName ?? '',
          cover_images: Array.isArray(dish.cover_images) ? dish.cover_images : [],
          price: dish.price ?? 0,
          tags: Array.isArray(dish.tags) ? dish.tags : [],
          flavor: dish.flavor ?? '',
          difficulty: dish.difficulty ?? '',
          cook_time: dish.cook_time ?? 0,
          summary: dish.summary ?? '',
          ingredients: Array.isArray(dish.ingredients) ? dish.ingredients : [],
          steps: Array.isArray(dish.steps) ? dish.steps : []
        }
        return true
      } catch (e) {
        await this.safeHideLoading(true)
        uni.showToast({ title: e?.message || '加载失败', icon: 'none' })
        setTimeout(() => this.leavePageWithoutAlert(), 150)
        return false
      } finally {
        await this.safeHideLoading()
      }
    },

    syncCateIndexByForm() {
      const cid = String(this.form.categoryId ?? '')
      const idx = this.cateList.findIndex((c) => String(c.cate_id) === cid)
      this.cateIndex = idx
    },

    onCateChange(e) {
      if (this.formLocked) return
      const idx = Number(e.detail.value)
      this.cateIndex = idx
      const c = this.cateList[idx]
      if (!c) return
      this.form.categoryId = c.cate_id
      this.form.categoryName = c.name
    },

    fixImg(url) {
      if (!url) return '/static/cover-default.png'
      let fixed = String(url).replace(/\s+/g, '')
      fixed = fixed.replace(/^https:\/*/i, 'https://')
      return fixed
    },

    coverSrc(v) {
      if (!v) return '/static/cover-default.png'
      const s = String(v).trim()

      if (s.startsWith('http')) return this.fixImg(s)
      if (s.startsWith('wxfile://') || s.startsWith('file://')) return s

      return this.coverUrlMap[s] || '/static/cover-default.png'
    },

    async hydrateCoverUrls() {
      const list = (this.form.cover_images || []).filter((x) => typeof x === 'string' && x.length)
      if (!list.length) return

      const ids = list.filter((s) => {
        s = String(s)
        return !s.startsWith('http') && !s.startsWith('wxfile://') && !s.startsWith('file://')
      })
      if (!ids.length) return

      for (const batch of chunkList(ids)) {
        try {
          const res = await uniCloud.getTempFileURL({ fileList: batch })
          ;(res.fileList || []).forEach((it) => {
            if (it.fileID && it.tempFileURL) this.coverUrlMap[it.fileID] = it.tempFileURL
          })
        } catch (e) {
          console.error('hydrateCoverUrls failed:', e)
        }
      }
    },

    async chooseAndUploadCover(source = 'album') {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      if (this.uploading) return

      const remaining = this.maxCoverImages - this.form.cover_images.length
      if (remaining <= 0) {
        uni.showToast({ title: `菜品图片最多${this.maxCoverImages}张`, icon: 'none' })
        return
      }

      let uploadFinished = false

      try {
        const isWeixinMP = process.env.UNI_PLATFORM === 'mp-weixin'
        let tempPaths = []

        if (isWeixinMP && typeof uni.chooseMedia === 'function') {
          const res = await uni.chooseMedia({
            count: remaining,
            mediaType: ['image'],
            sizeType: ['compressed'],
            sourceType: [source]
          })

          tempPaths = (res?.tempFiles || [])
            .map((x) => this.asPath(x?.tempFilePath) || this.asPath(x?.filePath) || this.asPath(x?.path))
            .filter((p) => typeof p === 'string' && p.length)
        } else {
          const res = await uni.chooseImage({
            count: remaining,
            sizeType: ['compressed'],
            sourceType: [source]
          })

          tempPaths = (res?.tempFilePaths || []).filter((p) => typeof p === 'string' && p.length)

          if (!tempPaths.length) {
            tempPaths = (res?.tempFiles || [])
              .map((x) => this.asPath(x?.path) || this.asPath(x?.tempFilePath))
              .filter((p) => typeof p === 'string' && p.length)
          }
        }

        tempPaths = tempPaths.slice(0, remaining)

        if (!tempPaths.length) {
          uni.showToast({ title: '未获取到图片路径', icon: 'none' })
          return
        }

        this.uploading = true
        this.uploadProgress = 0
        this.startFakeProgress()
        const totalCount = tempPaths.length

        for (let i = 0; i < tempPaths.length; i++) {
          const filePath = tempPaths[i]

          if (typeof filePath !== 'string' || !filePath) {
            console.error('[upload] invalid filePath:', filePath, tempPaths)
            uni.showToast({ title: '图片路径异常（非字符串）', icon: 'none' })
            continue
          }

          const ext = (filePath.split('.').pop() || 'jpg').toLowerCase()
          const cloudPath = `foods/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`

          const up = await uniCloud.uploadFile({
            filePath,
            cloudPath,
            onUploadProgress: (p) => {
              const total = Number(p?.totalBytesExpectedToSend || 0)
              const sent = Number(p?.totalBytesSent || 0)
              if (total > 0) {
                this.hasRealTotal = true
                const percent = Math.floor((sent / total) * 100)
                this.uploadProgress = Math.max(1, Math.min(99, percent))
              }
            }
          })

          const fileID = this.pickFileID(up)
          if (typeof fileID !== 'string' || !fileID) {
            console.error('[upload] invalid fileID from uploadFile:', up)
            uni.showToast({ title: '上传返回 fileID 异常', icon: 'none' })
            continue
          }

          this.form.cover_images.push(fileID)

          try {
            const tmp = await uniCloud.getTempFileURL({ fileList: [fileID] })
            const url = tmp?.fileList?.[0]?.tempFileURL
            if (typeof url === 'string' && url) {
            this.coverUrlMap[fileID] = url
            }
          } catch (e) {
            console.error('getTempFileURL failed:', e)
          }

          this.newlyUploadedCoverIds.push(fileID)
          addPendingCleanup('food', [fileID])

          const doneCount = i + 1
          this.uploadProgress = Math.min(99, Math.floor((doneCount / totalCount) * 100))
        }

        this.finishProgressAndHide()
        uploadFinished = true
      } catch (e) {
        uni.showToast({ title: e?.message || '选择/上传失败', icon: 'none' })
      } finally {
        this.stopFakeProgress()
        this.hasRealTotal = false
        if (!uploadFinished) {
          this.uploading = false
          this.uploadProgress = 0
        }
      }
    },

    startFakeProgress() {
      this.stopFakeProgress()
      this.hasRealTotal = false
      if (this.uploadProgress <= 0) this.uploadProgress = 1

      this.uploadTimer = setInterval(() => {
        if (this.hasRealTotal) return
        if (this.uploadProgress < 95) {
          const step = this.uploadProgress < 30 ? 3 : this.uploadProgress < 60 ? 2 : 1
          this.uploadProgress = Math.min(95, this.uploadProgress + step)
        }
      }, 200)
    },

    stopFakeProgress() {
      if (this.uploadTimer) {
        clearInterval(this.uploadTimer)
        this.uploadTimer = null
      }
    },

    finishProgressAndHide() {
      this.uploadProgress = 100
      this.stopFakeProgress()

      setTimeout(() => {
        this.uploading = false
        this.uploadProgress = 0
        this.hasRealTotal = false
      }, 350)
    },

    asPath(v) {
      if (typeof v === 'string') return v
      return ''
    },

    pickFileID(up) {
      if (typeof up?.fileID === 'string') return up.fileID
      if (typeof up?.fileId === 'string') return up.fileId
      if (Array.isArray(up?.fileID) && typeof up.fileID[0] === 'string') return up.fileID[0]
      return ''
    },

    removeCover(i) {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      const fid = this.form.cover_images[i]
      this.form.cover_images.splice(i, 1)
      if (fid && this.coverUrlMap[fid]) delete this.coverUrlMap[fid]
      if (this.newlyUploadedCoverIds.includes(fid)) this.cleanupPendingCovers([fid])
    },

    addTag() {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      const t = (this.tagInput || '').trim()
      if (!t) return
      if (!this.form.tags.includes(t)) {
        this.form.tags.push(t)
        uni.hideKeyboard()
      }
      this.tagInput = ''
    },
    removeTag(i) {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      this.form.tags.splice(i, 1)
    },

    addIngredient() {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      const t = (this.ingInput || '').trim()
      if (!t) return
      this.form.ingredients.push(t)
      this.ingInput = ''
      uni.hideKeyboard()
    },
    removeIngredient(i) {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      this.form.ingredients.splice(i, 1)
    },

    addStep() {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      const t = (this.stepInput || '').trim()
      if (!t) return
      this.form.steps.push(t)
      this.stepInput = ''
      uni.hideKeyboard()
    },
    removeStep(i) {
      if (this.formLocked) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限：请登录管理员账号', icon: 'none' })
        return
      }
      this.form.steps.splice(i, 1)
    },

    validate() {
      if (!(this.form.name || '').trim()) return '请填写菜名'
      if (!String(this.form.categoryId ?? '').length) return '请选择分类'

      const price = Number(this.form.price)
      if (Number.isNaN(price) || price < 0) return '价格不合法'

      const cook = Number(this.form.cook_time)
      if (Number.isNaN(cook) || cook < 0) return '时长不合法'

      return ''
    },

    normalizeForm(f) {
      return {
        foodId: f.foodId,
        name: (f.name || '').trim(),
        categoryId: f.categoryId === 0 || f.categoryId === '0' ? '0' : String(f.categoryId ?? ''),
        categoryName: (f.categoryName || '').trim(),
        cover_images: Array.isArray(f.cover_images) ? f.cover_images.filter((x) => typeof x === 'string' && x.trim()) : [],
        price: Number(f.price) || 0,
        tags: Array.isArray(f.tags) ? f.tags.filter(Boolean) : [],
        flavor: (f.flavor || '').trim(),
        difficulty: (f.difficulty || '').trim(),
        cook_time: Number(f.cook_time) || 0,
        summary: (f.summary || '').trim(),
        ingredients: Array.isArray(f.ingredients) ? f.ingredients.filter(Boolean) : [],
        steps: Array.isArray(f.steps) ? f.steps.filter(Boolean) : []
      }
    },

    isDirty() {
      return JSON.stringify(this.normalizeForm(this.form)) !== this.snapshot
    },

    async cleanupPendingCovers(fileIDs = this.newlyUploadedCoverIds) {
      const protectedIDs = new Set([...getProtectedCreateCovers(), ...getProtectedEditCovers()])
      const ids = [...new Set(fileIDs)].filter(id => id && !protectedIDs.has(id))
      if (!ids.length) return

      addPendingCleanup('food', ids)
      const token = this.getToken()
      if (!token) return

      try {
        const result = await foodService.cleanupUploadedCoverFiles(ids, token)
        applyNewToken(result)

        const confirmedSet = new Set(Array.isArray(result?.confirmedFileIDs) ? result.confirmedFileIDs : [])
        const confirmed = ids.filter((id) => confirmedSet.has(id))
        if (result?.skipped) console.warn('部分待清理图片未处理：', result.skipReason, result.skippedFileIDs)

        removePendingCleanup('food', confirmed)
        this.newlyUploadedCoverIds = this.newlyUploadedCoverIds.filter((id) => !confirmed.includes(id))
      } catch (e) {
        console.error('cleanup pending cover files failed:', e)
      }
    },

    commitCurrentCovers() {
      const current = new Set(this.form.cover_images || [])
      const committed = this.newlyUploadedCoverIds.filter((id) => current.has(id))
      removePendingCleanup('food', committed)
      this.newlyUploadedCoverIds = this.newlyUploadedCoverIds.filter((id) => !current.has(id))
    },

    async leaveWithCleanup() {
      await this.cleanupPendingCovers()
      await this.leavePageWithoutAlert({
        fail: () => {
          this.backLock = false
          uni.showToast({ title: '返回失败，请重试', icon: 'none' })
        }
      })
    },

    // ✅ 统一处理：没登录 / 非管理员
    ensureManageOrToast() {
      const token = this.getToken()
      if (!token) {
        uni.showToast({ title: '请先微信登录', icon: 'none' })
        return { ok: false, token: '' }
      }
      if (!this.canManage) {
        uni.showToast({ title: '无权限：仅管理员可操作', icon: 'none' })
        return { ok: false, token: '' }
      }
      return { ok: true, token }
    },

    async onSubmit() {
      if (this.createInitializing || this.leaveGuardLeaving || this.submitting || this.uploading) return

      const auth = this.ensureManageOrToast()
      if (!auth.ok) return

      const msg = (this.pendingCreate || this.pendingEdit) ? '' : this.validate()
      if (msg) {
        uni.showToast({ title: msg, icon: 'none' })
        return
      }

      const payload = this.pendingEdit ? this.pendingEdit.payload : (this.pendingCreate ? this.pendingCreate.payload : this.normalizeForm(this.form))

      this.safeShowLoading('提交中...')
      try {
        this.submitting = true

        if (this.mode === 'edit') {
          const uid = uni.getStorageSync('uni_id_uid') || ''
          if (!uid || uid !== this.createOwnerUid) throw new Error('登录状态已变化，请重新进入编辑页')
          if (!this.pendingEdit) {
            const request = {
              requestId: newFoodCreateId().replace(/^fc_/, 'fe_'),
              expectedVersion: this.foodVersion,
              payload: JSON.parse(JSON.stringify(payload)),
              uploadedCoverIds: [...this.newlyUploadedCoverIds]
            }
            // 本地保护落盘后才允许请求发出；超时和页面重开都不释放保护。
            saveFoodEditRequest(uid, this.foodId, request)
            this.pendingEdit = request
          }
          const request = this.pendingEdit
          const result = await foodService.updateFoodOnce(this.foodId, request.payload, auth.token, request.expectedVersion, request.requestId)
          applyNewToken(result)
          if (!result?.terminal) throw new Error(result?.msg || '修改结果尚未确认，请重试确认')
          if (Number(result.code) === 400 || Number(result.code) === 409) {
            clearFoodEditRequest(uid, this.foodId, request.requestId)
            this.pendingEdit = null
            await this.safeHideLoading(true)
            uni.showModal({
              title: Number(result.code) === 409 ? '菜品已更新' : '本次修改未保存',
              content: result.msg || '本次修改未保存，请先保留需要的内容，再重新打开编辑页。',
              showCancel: false,
              confirmText: '知道了'
            })
            return
          }
          if (!result?.updated || result.code) throw new Error(result?.msg || '保存失败，请重试')
          this.foodVersion = result.version
          // 先从清理队列移除已提交图片，再解除持久化保护。
          removePendingCleanup('food', request.payload.cover_images || [])
          clearFoodEditRequest(uid, this.foodId, request.requestId)
          this.pendingEdit = null
          this.commitCurrentCovers()

          uni.setStorageSync('needRefreshFoodDetail', this.foodId)
          uni.setStorageSync('needRefreshFoods', 1)
          await this.safeHideLoading(true)

          await this.preparePageLeave()
          uni.showToast({ title: result.replayed ? '已确认此前修改成功' : '修改成功', icon: 'success' })
          setTimeout(() => this.leavePageWithoutAlert(), 150)
          return
        }

        const uid = uni.getStorageSync('uni_id_uid') || ''
        if (!uid || uid !== this.createOwnerUid) throw new Error('登录状态已变化，请重新进入新增页')
        if (!this.pendingCreate) {
          const request = {
            requestId: this.createRequestId || newFoodCreateId(),
            payload: JSON.parse(JSON.stringify(payload)),
            uploadedCoverIds: [...this.newlyUploadedCoverIds]
          }
          // 持久化成功后才发送，超时、退页、重开都继续使用同一次提交。
          saveFoodCreateRequest(uid, request)
          this.createRequestId = request.requestId
          this.pendingCreate = request
        }
        const result = await foodService.addFoodOnce(this.pendingCreate.payload, auth.token, this.pendingCreate.requestId)
        applyNewToken(result)
        if (Number(result?.code) === 400) {
          clearFoodCreateRequest(uid, this.pendingCreate.requestId)
          this.pendingCreate = null
          this.createRequestId = ''
          throw new Error(result.msg || '请检查菜品内容')
        }
        if (Number(result?.code) !== 0 || !result?.id) throw new Error(result?.msg || '发布结果尚未确认，请重试确认')
        removePendingCleanup('food', this.pendingCreate.payload.cover_images || [])
        clearFoodCreateRequest(uid, this.pendingCreate.requestId)
        this.pendingCreate = null
        this.commitCurrentCovers()
        uni.setStorageSync('needRefreshFoods', 1)
        await this.safeHideLoading(true)
        await this.preparePageLeave()
        uni.showToast({ title: result.replayed ? '已确认此前发布成功' : '新增成功', icon: 'success' })
        setTimeout(() => this.leavePageWithoutAlert(), 150)
      } catch (e) {
        console.error(e)
        await this.safeHideLoading(true)
        uni.showToast({ title: this.pendingEdit ? '修改结果待确认，请重试确认' : (this.pendingCreate ? (e?.message || '发布结果尚未确认，请重试确认') : (e?.message || '提交失败')), icon: 'none' })
      } finally {
        await this.safeHideLoading()
        this.submitting = false
      }
    },

    onCancel() {
      if (this.submitting || this.uploading) {
        return
      }
      if (this.backLock) return
      if (this.isDirty()) {
        this.backLock = true
        uni.showModal({
          title: '提示',
          content: this.pendingEdit ? '修改结果尚未确认，离开后可重新进入此菜品编辑页继续确认。' : '内容尚未保存，确定要离开吗？',
          success: async (res) => {
            if (res.confirm) {
              await this.leaveWithCleanup()
            } else {
              this.backLock = false
            }
          },
          fail: () => {
            this.backLock = false
          }
        })
        return
      }
      this.backLock = true
      this.leaveWithCleanup()
    }
  }
}
</script>

<style lang="scss">
page {
  background: #f5f5f5;
  height: 100%;
}

.page {
  min-height: 100vh;
}

.header {
  padding: 24rpx 24rpx 8rpx;
}
.title {
  font-size: 36rpx;
  font-weight: 700;
  color: #333;
}

/* 内容：为底部固定按钮留空间 */
.content {
  padding: 0 20rpx;
  overflow: hidden;
  padding-bottom: calc(140rpx + env(safe-area-inset-bottom) + 16rpx);
}

.card {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin: 16rpx 0;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.06);
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
  margin-bottom: 16rpx;
  color: #333;
}

.row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 18rpx;
}
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 10rpx;
}
.label {
  width: 160rpx;
  color: #666;
  font-size: 28rpx;
}
.row.col .label {
  width: auto;
}

.input,
.picker-view {
  flex: 1;
  background: #f7f7f7;
  border-radius: 14rpx;
  padding: 18rpx 16rpx;
  font-size: 28rpx;
}
.picker {
  flex: 1;
}
.placeholder {
  color: #999;
}

.textarea {
  background: #f7f7f7;
  border-radius: 14rpx;
  padding: 18rpx 16rpx;
  font-size: 28rpx;
  min-height: 140rpx;
}

/* ===== 图片区 ===== */
.img-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.img-item {
  width: 210rpx;
}
.img {
  width: 210rpx;
  height: 140rpx;
  border-radius: 14rpx;
  background: #eee;
}
.img-actions {
  margin-top: 10rpx;
  display: flex;
  justify-content: center;
}

/* ===== 标签 chip 更产品化 ===== */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 8rpx;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 10rpx;
  padding: 10rpx 14rpx;
  border-radius: 999rpx;
  background: #fff7ed;
  border: 1rpx solid #fed7aa;
}
.chip-text {
  font-size: 24rpx;
  color: #f97316;
  font-weight: 700;
}
.chip-x {
  width: 34rpx;
  height: 34rpx;
  border-radius: 999rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ffedd5;
  color: #f97316;
  font-size: 26rpx;
  font-weight: 900;
}

/* ===== 列表更“产品化” ===== */
.list {
  margin-top: 8rpx;
}
.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.li-text {
  color: #333;
  font-size: 28rpx;
  flex: 1;
  padding-right: 16rpx;
}

/* ===== 小按钮体系：添加/删除（有层次感） ===== */
.btn.small {
  height: 72rpx;
  border-radius: 18rpx;
  font-size: 28rpx;
  font-weight: 700;
}

.btn-add {
  background: #ff6b35;
  color: #fff;
  box-shadow: 0 6rpx 16rpx rgba(0, 0, 0, 0.12);
  border: 1rpx solid rgba(0, 0, 0, 0.06);
}

.mini-btn {
  height: 56rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.mini-danger {
  color: #ff4d4f;
  background: #fff1f0;
  border: 1rpx solid #ffccc7;
}

.mini-btn:active,
.btn-add:active {
  transform: scale(0.98);
  opacity: 0.92;
}

/* ===== 底部按钮：固定 + 安全区白底填充 ===== */
.bottom {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;

  z-index: 9999;
  background: #fff;
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.08);

  display: flex;
  gap: 16rpx;

  padding: 14rpx 20rpx 18rpx;
  padding-bottom: calc(18rpx + env(safe-area-inset-bottom));
}

.bottom::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;

  height: constant(safe-area-inset-bottom);
  height: env(safe-area-inset-bottom);
  background: #fff;
}

.btn {
  flex: 1;
  height: 88rpx;
  border-radius: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 700;
}
.btn.ghost {
  background: #f7f7f7;
  color: #666;
}
.btn.primary {
  background: #ff6b35;
  color: #fff;
}
.btn.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.row.split {
  align-items: center;
}
.row.split .grow {
  flex: 1;
}
.row.split .shrink {
  flex: 0 0 160rpx;
}
</style>
