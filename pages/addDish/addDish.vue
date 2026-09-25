<template>
  <view class="editor-page">
    <view class="header">
      <view class="heading-row"><text class="title">{{ mode === 'edit' ? '修改菜品' : '新增菜品' }}</text><image v-if="!badgeFailed" class="chef-badge" src="/static/detail/chef-badge.png" mode="aspectFit" @error="badgeFailed = true" /></view><text class="subtitle">{{ mode === 'edit' ? '更新这道家的味道' : '记录一道家的味道' }}</text>
    </view>

    <view class="content">
      <view v-if="createInitializing" class="notice">正在加载表单，请稍候…</view>
      <view v-else-if="initError" class="notice"><text>{{ initError }}</text><button class="retry" size="mini" @click="initializeEditor">重新加载</button></view>
      <view v-else-if="!canManage" class="notice">仅管理员可新增或修改菜品，请登录管理员账号后重新进入。</view>
      <view v-if="categoryError || (!createInitializing && !cateList.length)" class="notice"><text>{{ categoryError || '暂无可用分类，请配置分类后重试' }}</text><button class="retry" size="mini" :disabled="formLocked || categoryLoading" @click="retryCategories">重试分类</button></view>
      <view v-if="pendingCreate" class="notice">
        <text>发布结果待确认，请点击底部“重试确认”。确认完成前暂不能修改内容，离开后可再次进入继续确认。</text>
      </view>
      <view v-if="pendingEdit" class="notice">
        <text>修改结果待确认，请点击底部“重试确认”。确认前暂不能修改内容，离开后可重新进入此菜品编辑页继续确认。</text>
      </view>
      <!-- 基础信息 -->
      <view class="card"><view class="section-title"><text class="section-icon">▤</text><text>基本信息</text></view>
        <view class="row">
          <text class="label">菜名</text>
          <input :disabled="fieldsDisabled" class="input" v-model="form.name" :maxlength="Math.max(50, String(form.name || '').length)" placeholder="例如：麻婆豆腐" />
        </view>

        <view class="row">
          <text class="label">价格</text>
          <input :disabled="fieldsDisabled" class="input" type="digit" v-model="form.price" placeholder="例如：880" />
        </view>

        <view class="row">
          <text class="label">菜品分类</text>
          <picker :disabled="fieldsDisabled || categoryLoading || !cateList.length" class="picker" :range="cateList" range-key="name" :value="cateIndex" @change="onCateChange">
            <view class="picker-view">
              <text v-if="cateList[cateIndex]">{{ cateList[cateIndex].name }}</text>
              <text v-else class="placeholder">{{ form.categoryName ? form.categoryName + '（请重新选择）' : '请选择分类' }}</text><text class="picker-arrow">⌄</text>
            </view>
          </picker>
        </view>

        <view class="row">
          <text class="label">口味</text>
          <input :disabled="fieldsDisabled" class="input" v-model="form.flavor" :maxlength="Math.max(50, String(form.flavor || '').length)" placeholder="例如：咸香微辣/酸甜可口" />
        </view>

        <view class="row">
          <text class="label">难度</text>
          <input :disabled="fieldsDisabled" class="input" v-model="form.difficulty" :maxlength="Math.max(50, String(form.difficulty || '').length)" placeholder="例如：简单/中等/困难" />
        </view>

        <view class="row">
          <text class="label">时长(分)</text>
          <input :disabled="fieldsDisabled" class="input" type="number" v-model="form.cook_time" placeholder="例如：10" />
        </view>

        <view class="row col">
          <text class="label">菜品简介</text>
          <textarea :disabled="fieldsDisabled" class="textarea" v-model="form.summary" :maxlength="Math.max(300, String(form.summary || '').length)" placeholder="一句话介绍菜品" />
        </view>
      </view>

      <!-- 封面图（✅ 存 fileID，展示用临时 URL） -->
      <view class="card">
        <view class="section-title"><text class="section-icon">▧</text><text>菜品图片（{{ form.cover_images.length }}/{{ maxCoverImages }}）</text></view>

        <view class="img-list" v-if="form.cover_images.length">
          <view class="img-item" v-for="(fid, idx) in form.cover_images" :key="idx">
            <image class="img" :src="failedCovers[fid] ? '/static/cover-default.png' : coverSrc(fid)" @error="onCoverError(fid)" mode="aspectFill" />
            <view class="img-actions">
              <button class="mini-btn mini-danger" @click="removeCover(idx)" :disabled="fieldsDisabled">删除</button>
            </view>
          </view>
        </view>

        <view class="row">
          <button class="btn small btn-add upload-choice"
            :disabled="fieldsDisabled || form.cover_images.length >= maxCoverImages"
            @click="chooseAndUploadCover('album')"
          >
            <text class="upload-icon">▧</text><text>{{ (uploading || choosingCover) ? '处理中...' : (form.cover_images.length >= maxCoverImages ? '已达图片上限' : '从相册选择') }}</text>
          </button>
          <button class="btn small btn-add upload-choice"
            :disabled="fieldsDisabled || form.cover_images.length >= maxCoverImages"
            @click="chooseAndUploadCover('camera')"
          >
            <view class="camera-icon" /><text>{{ (uploading || choosingCover) ? '处理中...' : (form.cover_images.length >= maxCoverImages ? '已达图片上限' : '拍照上传') }}</text>
          </button>
        </view>

        <view class="row" v-if="uploading">
          <text class="label">上传进度</text>
          <text class="placeholder">上传中，请稍候…</text>
        </view>

        <view class="row" v-if="!canManage">
          <text class="placeholder">登录管理员账号后才可上传/编辑</text>
        </view>
      </view>

      <!-- tags -->
      <view class="card">
        <view class="section-title"><text class="section-icon">◇</text><text>标签</text></view>

        <view class="row split">
          <input :disabled="fieldsDisabled" class="input grow" v-model="tagInput" :maxlength="30" placeholder="例如：下饭/好吃" />
          <button class="btn small btn-add shrink" :class="{ disabled: formLocked || !canManage }" @click="addTag" :disabled="fieldsDisabled">添加</button>
        </view>

        <view class="chips" v-if="form.tags.length">
          <view class="chip" v-for="(t, i) in form.tags" :key="i">
            <text class="chip-text">{{ t }}</text>
            <button class="chip-x" @click="removeTag(i)" :disabled="fieldsDisabled">×</button>
          </view>
        </view>
      </view>

      <!-- ingredients -->
      <view class="card">
        <view class="section-title"><text class="section-icon">♧</text><text>食材清单</text></view>

        <view class="row split">
          <input :disabled="fieldsDisabled" class="input grow" v-model="ingInput" :maxlength="80" placeholder="例如：肥牛/猪肉" />
          <button class="btn small btn-add shrink" :class="{ disabled: formLocked || !canManage }" @click="addIngredient" :disabled="fieldsDisabled">添加</button>
        </view>

        <view class="list" v-if="form.ingredients.length">
          <view class="list-item" v-for="(it, i) in form.ingredients" :key="i">
            <text class="li-text">{{ i + 1 }}. {{ it }}</text>
            <button class="mini-btn mini-danger" @click="removeIngredient(i)" :disabled="fieldsDisabled">删除</button>
          </view>
        </view>
      </view>

      <!-- steps -->
      <view class="card">
        <view class="section-title"><text class="section-icon">☷</text><text>制作步骤</text></view>

        <view class="row split">
          <textarea :disabled="fieldsDisabled" class="input grow" v-model="stepInput" placeholder="例如：猪肉焯水..."  :maxlength="300" auto-height :show-confirm-bar="true" />
          <button class="btn small btn-add shrink" :class="{ disabled: formLocked || !canManage }" @click="addStep" :disabled="fieldsDisabled">添加</button>
        </view>

        <view class="list" v-if="form.steps.length">
          <view class="list-item" v-for="(it, i) in form.steps" :key="i">
            <text class="step-number">{{ i + 1 }}</text><text class="li-text">{{ it }}</text>
            <button class="mini-btn mini-danger" @click="removeStep(i)" :disabled="fieldsDisabled">删除</button>
          </view>
        </view>
      </view>
    </view>

    <!-- ✅ 底部按钮：固定 -->
    <view v-show="!keyboardVisible" class="bottom">
      <button class="btn ghost" @click="onCancel" :disabled="cancelDisabled">取消</button>
      <button class="btn primary" :class="{ disabled: submitting || uploading || createInitializing || leaveGuardLeaving || !canManage }" @click="onSubmit" :disabled="submitDisabled">
        {{ submitting ? '提交中...' : ((pendingEdit || pendingCreate) ? '重试确认' : (mode === 'edit' ? '保存修改' : '发布菜品')) }}
      </button>
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
    fieldsDisabled() { return this.formLocked || !this.canManage || !!this.initError },
    submitDisabled() { return this.createInitializing || !!this.initError || this.submitting || this.uploading || this.choosingCover || this.leaveGuardLeaving || !this.canManage },
    cancelDisabled() { return this.submitting || this.uploading || this.choosingCover || this.leaveGuardLeaving || this.backLock },
    formLocked() {
      return this.createInitializing || !!this.initError || this.submitting || this.uploading || this.choosingCover ||
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
      initError: '', initializingTask: false, categoryError: '', categoryLoading: false, choosingCover: false,
      keyboardVisible: false, keyboardActive: true, keyboardListener: null,
      badgeFailed: false, failedCovers: {},
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

    await this.initializeEditor()
  },
  onReady() {
    this.keyboardListener = event => { if (this.keyboardActive) this.keyboardVisible = Number(event.height) > 0 }
    if (typeof uni.onKeyboardHeightChange === 'function') uni.onKeyboardHeightChange(this.keyboardListener)
  },
  onShow() { this.keyboardActive = true },
  onHide() { this.keyboardActive = false; this.keyboardVisible = false },

  // 页面离开兜底：提交/上传进行中时只保留待清理记录，避免与写库请求并发删除图片。
  onUnload() {
    if (this.keyboardListener && typeof uni.offKeyboardHeightChange === 'function') uni.offKeyboardHeightChange(this.keyboardListener)
    this.keyboardActive = false
    this.safeHideLoading(true)
    this.stopFakeProgress()
    if (!this.submitting && !this.uploading) {
      this.cleanupPendingCovers()
    }
  },

  onBackPress() {
    if (this.leaveGuardLeaving) return false
    if (this.submitting || this.uploading || this.choosingCover) {
      return true
    }
    if (this.backLock) return true
    if (this.needsLeaveConfirmation()) {
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
    async initializeEditor() {
      if (this.initializingTask) return
      this.initializingTask = true
      this.createInitializing = true
      this.initError = ''
      try {
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
              this.initError = error.message || '读取待确认修改失败'
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
              this.initError = error.message || '读取待确认发布失败'
              return
            }
          }
          this.newlyUploadedCoverIds = [...new Set([...getPendingCleanup('food'), ...(this.pendingCreate?.uploadedCoverIds || []), ...(this.pendingEdit?.uploadedCoverIds || [])])]
          await this.cleanupPendingCovers()
        }

        if (this.mode === 'edit') {
          if (!this.foodId) {
            this.initError = '缺少菜品id，请返回后重新进入'
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
      } catch (error) {
        this.initError = error.message || '表单加载失败，请重试'
      } finally {
        this.createInitializing = false
        this.initializingTask = false
      }
    },
    async retryCategories() {
      if (this.formLocked || this.categoryLoading) return
      await this.loadCategories()
      this.syncCateIndexByForm()
    },
    hasInputDraft() { return [this.tagInput, this.ingInput, this.stepInput].some(value => String(value || '').trim()) },
    needsLeaveConfirmation() { return !!this.pendingCreate || !!this.pendingEdit || this.hasInputDraft() || !!(this.snapshot && this.isDirty()) },
    onCoverError(fid) { if (!this.failedCovers[fid]) this.failedCovers = { ...this.failedCovers, [fid]: true } },
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
      this.categoryLoading = true
      this.categoryError = ''
      try {
        const list = await foodService.getCategories()
        this.cateList = Array.isArray(list) ? list : []
      } catch (e) {
        this.categoryError = e?.message || '分类加载失败'
        this.cateList = []
      } finally { this.categoryLoading = false }
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
        this.initError = e?.message || '菜品加载失败，请重试'
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

      this.choosingCover = true
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
        if (!/cancel/i.test(e?.errMsg || e?.message || '')) uni.showToast({ title: e?.message || '选择/上传失败', icon: 'none' })
      } finally {
        this.stopFakeProgress()
        this.hasRealTotal = false
        this.choosingCover = false
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
      if (t.length > 30) { uni.showToast({ title: '标签最长30字符', icon: 'none' }); return }
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
      if (t.length > 80) { uni.showToast({ title: '食材最长80字符', icon: 'none' }); return }
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
      if (t.length > 300) { uni.showToast({ title: '步骤最长300字符', icon: 'none' }); return }
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
      if (this.categoryError || !this.cateList.length) return '请先加载可用分类'
      if (!this.cateList.some(c => String(c.cate_id) === String(this.form.categoryId))) return '原分类已不可用，请重新选择'
      if (this.hasInputDraft()) return '请先添加或清空下方输入内容'
      for (const [key, label, max] of [['name', '菜名', 50], ['flavor', '口味', 50], ['difficulty', '难度', 50], ['summary', '简介', 300]]) {
        if (String(this.form[key] || '').trim().length > max) return label + '最长' + max + '字符'
      }
      for (const [key, label, max] of [['tags', '标签', 30], ['ingredients', '食材', 80], ['steps', '步骤', 300]]) {
        if (this.form[key].some(item => String(item || '').trim().length > max)) return label + '单项最长' + max + '字符'
      }

      const price = Number(this.form.price)
      if (!Number.isFinite(price) || price < 0) return '价格不合法'

      const cook = Number(this.form.cook_time)
      if (!Number.isFinite(cook) || cook < 0) return '时长不合法'

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
      if (this.createInitializing || this.initError || this.leaveGuardLeaving || this.submitting || this.uploading || this.choosingCover) return

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
      if (this.submitting || this.uploading || this.choosingCover) {
        return
      }
      if (this.backLock) return
      if (this.needsLeaveConfirmation()) {
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
        return
      }
      this.backLock = true
      this.leaveWithCleanup()
    }
  }
}
</script>

<style>page { background: #FFFBEB; }</style>
<style scoped>
.editor-page { --action-height: 120rpx; min-height: 100vh; background: #FFFBEB; color: #40291C; }
.header { padding: 32rpx 32rpx 12rpx; }
.heading-row { display: flex; align-items: center; gap: 18rpx; }
.title { font-size: 48rpx; font-weight: 800; }
.chef-badge { width: 102rpx; height: 108rpx; }
.subtitle { display: block; font-size: 25rpx; color: #968875; margin-top: -6rpx; }
.content { padding: 0 24rpx calc(var(--action-height) + 24rpx + env(safe-area-inset-bottom)); }
.card { margin: 20rpx 0; padding: 24rpx; border-radius: 28rpx; background: #FFFEF9; box-shadow: 0 8rpx 24rpx rgba(163,122,37,.05); }
.section-title { display: flex; align-items: center; gap: 16rpx; font-size: 30rpx; font-weight: 800; margin-bottom: 22rpx; }
.section-icon { width: 48rpx; height: 48rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 50%; color: #966900; background: #FFEDAC; font-size: 32rpx; }
.row { display: flex; align-items: center; gap: 14rpx; margin-bottom: 16rpx; }
.row:last-child { margin-bottom: 0; }
.label { flex: 0 0 146rpx; font-size: 26rpx; color: #684E3C; }
.input, .picker-view, .textarea { min-width: 0; box-sizing: border-box; background: #FCF6DF; border-radius: 15rpx; padding: 16rpx; font-size: 26rpx; color: #382518; }
.input { flex: 1; height: 72rpx; }
.picker { flex: 1; min-width: 0; }
.picker-view { min-height: 72rpx; display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.picker-view text { overflow-wrap: anywhere; }
.picker-arrow { flex-shrink: 0; font-size: 30rpx; color: #918372; }
.placeholder { color: #A49682; font-size: 24rpx; }
.row.col { flex-direction: column; align-items: stretch; gap: 12rpx; }
.row.col .label { flex: auto; }
.textarea { width: 100%; height: 200rpx; line-height: 1.6; }
.split .input { flex: 1; width: 0; }
.split textarea.input { min-height: 72rpx; height: auto; line-height: 1.5; }
.btn { margin: 0; min-width: 0; box-sizing: border-box; flex: 1; display: flex; align-items: center; justify-content: center; min-height: 88rpx; padding: 10rpx 16rpx; border-radius: 44rpx; line-height: 1.4; font-size: 29rpx; font-weight: 700; }
button::after { border: 0; }
.btn.small { min-height: 72rpx; border-radius: 16rpx; font-size: 26rpx; }
.btn-add { color: #54380B; background: linear-gradient(110deg,#FFE083,#FFD14C); }
.upload-choice { gap: 10rpx; }
.upload-icon { font-size: 30rpx; }
.camera-icon { width: 28rpx; height: 22rpx; border-radius: 4rpx; background: currentColor; position: relative; flex-shrink: 0; }
.camera-icon::before { content: ''; position: absolute; width: 12rpx; height: 5rpx; left: 8rpx; top: -4rpx; background: currentColor; border-radius: 3rpx 3rpx 0 0; }
.camera-icon::after { content: ''; position: absolute; width: 10rpx; height: 10rpx; border: 2rpx solid #FFF5D5; border-radius: 50%; left: 7rpx; top: 4rpx; }
.step-number { min-width: 42rpx; height: 42rpx; padding: 0 4rpx; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #E9AF22; color: white; font-size: 24rpx; flex-shrink: 0; }
.split .shrink { flex: 0 0 128rpx; }
.img-list + .row .btn, .card > .row .btn-add:not(.shrink) { border: 1rpx solid #F0BE42; background: #FFF5D5; color: #79530A; }
.img-list { display: flex; flex-wrap: wrap; gap: 12rpx; margin-bottom: 20rpx; }
.img-item { width: calc((100% - 24rpx) / 3); min-width: 0; }
.img { width: 100%; height: 140rpx; border-radius: 14rpx; background: #F4ECD8; }
.img-actions { display: flex; justify-content: center; margin-top: 8rpx; }
.mini-btn { margin: 0; flex-shrink: 0; padding: 8rpx 14rpx; line-height: 1.5; font-size: 23rpx; border-radius: 14rpx; }
.mini-danger { color: #E46846; background: #FFF0E8; }
.chips { display: flex; flex-wrap: wrap; gap: 12rpx; }
.chip { display: flex; align-items: center; gap: 8rpx; max-width: 100%; box-sizing: border-box; padding: 8rpx 12rpx 8rpx 18rpx; border-radius: 36rpx; background: #FFF0BB; }
.chip-text { min-width: 0; font-size: 25rpx; overflow-wrap: anywhere; }
.chip-x { margin: 0; flex-shrink: 0; width: 44rpx; height: 44rpx; padding: 0; line-height: 44rpx; background: transparent; color: #AD7C1D; }
.list-item { display: flex; align-items: flex-start; gap: 16rpx; padding: 16rpx 0; border-bottom: 1rpx solid #F0E7D3; }
.list-item:last-child { border: 0; }
.li-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 26rpx; line-height: 1.65; }
.notice { padding: 20rpx; margin: 18rpx 0; border-radius: 18rpx; background: #FFF0BE; color: #806126; font-size: 25rpx; line-height: 1.6; }
.retry { margin: 12rpx 0 0; background: #FFFEF9; color: #805A17; }
.bottom { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; box-sizing: border-box; height: calc(var(--action-height) + env(safe-area-inset-bottom)); padding: 14rpx 24rpx calc(18rpx + env(safe-area-inset-bottom)); display: flex; gap: 16rpx; background: #FFFEF9; box-shadow: 0 -4rpx 20rpx rgba(145,110,37,.05); }
.btn.ghost { color: #8C857B; background: #F4F1EB; }
.btn.primary { color: #4D3309; background: linear-gradient(110deg,#FFDF73,#FFD047); }
button[disabled] { opacity: .5; }
@media screen and (max-width: 350px) { .label { flex-basis: 126rpx; font-size: 25rpx; } .card { padding: 20rpx; } .split .shrink { flex-basis: 112rpx; } }
</style>
