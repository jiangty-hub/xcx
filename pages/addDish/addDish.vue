<template>
  <view class="page">
    <view class="header">
      <text class="title">{{ mode === 'edit' ? '修改菜品' : '新增菜品' }}</text>
    </view>

    <view class="content">
      <!-- 基础信息 -->
      <view class="card">
        <view class="row">
          <text class="label">菜名</text>
          <input class="input" v-model="form.name" placeholder="例如：麻婆豆腐" />
        </view>

        <view class="row">
          <text class="label">价格</text>
          <input class="input" type="number" v-model="form.price" placeholder="例如：880" />
        </view>

        <view class="row">
          <text class="label">菜品分类</text>
          <picker class="picker" :range="cateList" range-key="name" :value="cateIndex" @change="onCateChange">
            <view class="picker-view">
              <text v-if="cateIndex !== -1">{{ cateList[cateIndex].name }}</text>
              <text v-else class="placeholder">请选择分类</text>
            </view>
          </picker>
        </view>

        <view class="row">
          <text class="label">口味</text>
          <input class="input" v-model="form.flavor" placeholder="例如：咸香微辣/酸甜可口" />
        </view>

        <view class="row">
          <text class="label">难度</text>
          <input class="input" v-model="form.difficulty" placeholder="例如：简单/中等/困难" />
        </view>

        <view class="row">
          <text class="label">时长(分)</text>
          <input class="input" type="number" v-model="form.cook_time" placeholder="例如：10" />
        </view>

        <view class="row col">
          <text class="label">菜品简介</text>
          <textarea class="textarea" v-model="form.summary" placeholder="一句话介绍菜品" />
        </view>
      </view>

      <!-- 封面图（✅ 存 fileID，展示用临时 URL） -->
      <view class="card">
        <view class="section-title">菜品图片</view>

        <view class="img-list" v-if="form.cover_images.length">
          <view class="img-item" v-for="(fid, idx) in form.cover_images" :key="idx">
            <image class="img" :src="coverSrc(fid)" mode="aspectFill" />
            <view class="img-actions">
              <view class="mini-btn mini-danger" @click="removeCover(idx)">删除</view>
            </view>
          </view>
        </view>

        <view class="row">
          <view class="btn small btn-add" :class="{ disabled: uploading }" @click="chooseAndUploadCover('album')">
            {{ uploading ? '上传中...' : '从相册选择' }}
          </view>
          <view class="btn small btn-add" :class="{ disabled: uploading }" @click="chooseAndUploadCover('camera')">
            {{ uploading ? '上传中...' : '拍照上传' }}
          </view>
        </view>

        <view class="row" v-if="uploading">
          <text class="label">上传进度</text>
          <text class="placeholder">{{ uploadProgress }}%</text>
        </view>
      </view>

      <!-- tags -->
      <view class="card">
        <view class="section-title">标签</view>

        <view class="row split">
          <input class="input grow" v-model="tagInput" placeholder="例如：下饭/好吃" />
          <view class="btn small btn-add shrink" @click="addTag">添加</view>
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
          <input class="input grow" v-model="ingInput" placeholder="例如：肥牛/猪肉" />
          <view class="btn small btn-add shrink" @click="addIngredient">添加</view>
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
          <input class="input grow" v-model="stepInput" placeholder="例如：猪肉焯水..." />
          <view class="btn small btn-add shrink" @click="addStep">添加</view>
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
      <view class="btn primary" :class="{ disabled: submitting || uploading }" @click="onSubmit">
        {{ submitting ? '提交中...' : (mode === 'edit' ? '保存修改' : '发布菜品') }}
      </view>
    </view>
  </view>
</template>

<script>
const foodService = uniCloud.importObject('food-service')

export default {
  data() {
    return {
      mode: 'add',
      foodId: '',
      submitting: false,
      cateList: [],
      cateIndex: -1,

      // 图片：数据库存 fileID；页面展示用临时 URL 缓存
      coverUrlMap: {},
      uploading: false,
      uploadProgress: 0,
	  uploadTimer: null,
	  hasRealTotal: false,
	  
	  backLock: false,

      // 关键：loading 计数器
      loadingCount: 0,

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

    if (this.mode === 'edit') {
      if (!this.foodId) {
        uni.showToast({ title: '缺少菜品id', icon: 'none' })
        uni.navigateBack()
        return
      }
      await this.loadForEdit()
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
  },

  // ✅ 页面离开兜底：强制关闭 loading（避免残留）
  onUnload() {
    this.safeHideLoading(true)
  },

  onBackPress() {
	if (this.backLock) return true
    if (this.isDirty()) {
	  this.backLock = true
      uni.showModal({
        title: '提示',
        content: '内容尚未保存，确定要离开吗？',
        success: (res) => {
          if (res.confirm) {
            this.backLock = false
            uni.navigateBack()
          } else {
            this.backLock = false
          }
		},
		fail: () => {this.backLock = false}
      })
      return true
    }
    return false
  },

  methods: {
    // ✅ showLoading 包装：计数 + try/catch
    safeShowLoading(title = '加载中...') {
      this.loadingCount = (this.loadingCount || 0) + 1
      try {
        uni.showLoading({ title, mask: true })
      } catch (e) {
        console.warn('showLoading failed:', e)
      }
    },

    // ✅ hideLoading 包装：只在真正 show 过时才 hide；并延迟到下一轮，避开 toast 状态竞争
    safeHideLoading(force = false) {
      if (!force) {
        this.loadingCount = Math.max(0, (this.loadingCount || 0) - 1)
        if (this.loadingCount > 0) return
      } else {
        this.loadingCount = 0
      }
	this.$nextTick(() => {
		setTimeout(() => {
			try {
				const r = uni.hideLoading()
				if (r && typeof r.catch === 'function') r.catch(() => {})
				} catch (e) {}
			}, 16)
		  })
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
      } catch (e) {
        uni.showToast({ title: e?.message || '加载失败', icon: 'none' })
        this.safeHideLoading(true) // ✅ 先强制关
        setTimeout(() => uni.navigateBack(), 150)
      } finally {
        this.safeHideLoading()
      }
    },

    syncCateIndexByForm() {
      const cid = String(this.form.categoryId ?? '')
      const idx = this.cateList.findIndex(c => String(c.cate_id) === cid)
      this.cateIndex = idx
    },

    onCateChange(e) {
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
    
      // 1) 直接可用的网络图
      if (s.startsWith('http')) return this.fixImg(s)
    
      // 2) 本地临时路径（刚选择的图片可能是这些）
      if (s.startsWith('wxfile://') || s.startsWith('file://')) return s
    
      // 3) 云文件 fileID / cloud:// ：走缓存（hydrateCoverUrls 或上传后 getTempFileURL）
      return this.coverUrlMap[s] || '/static/cover-default.png'
    },

    async hydrateCoverUrls() {
      const list = (this.form.cover_images || [])
        .filter(x => typeof x === 'string' && x.length)
    
      if (!list.length) return
    
      // 只处理：既不是 http，也不是本地路径的（cloud:// / fileID）
      const ids = list.filter(s => {
        s = String(s)
        return !s.startsWith('http') && !s.startsWith('wxfile://') && !s.startsWith('file://')
      })
    
      if (!ids.length) return
    
      try {
        const res = await uniCloud.getTempFileURL({ fileList: ids })
        ;(res.fileList || []).forEach(it => {
          if (it.fileID && it.tempFileURL) this.$set(this.coverUrlMap, it.fileID, it.tempFileURL)
        })
      } catch (e) {
        console.error('hydrateCoverUrls failed:', e)
      }
    },

	async chooseAndUploadCover(source = 'album') {
	  if (this.uploading) return
	
	  try {
	    const isWeixinMP = process.env.UNI_PLATFORM === 'mp-weixin'
	    let tempPaths = []
	
	    // 1) 拿到本地临时路径（保证是 string[]）
	    if (isWeixinMP && typeof uni.chooseMedia === 'function') {
	      const res = await uni.chooseMedia({
	        count: 9,
	        mediaType: ['image'],
	        sizeType: ['compressed'],
	        sourceType: [source]
	      })
	
	      // chooseMedia 结构：tempFiles: [{ tempFilePath }]
	      tempPaths = (res?.tempFiles || [])
	        .map(x => this.asPath(x?.tempFilePath) || this.asPath(x?.filePath) || this.asPath(x?.path))
	        .filter(p => typeof p === 'string' && p.length)
	    } else {
	      const res = await uni.chooseImage({
	        count: 9,
	        sizeType: ['compressed'],
	        sourceType: [source]
	      })
	
	      // ✅ 最稳定：tempFilePaths 一定是 string[]
	      tempPaths = (res?.tempFilePaths || [])
	        .filter(p => typeof p === 'string' && p.length)
	
	      // 兜底：某些端 tempFiles 才有
	      if (!tempPaths.length) {
	        tempPaths = (res?.tempFiles || [])
	          .map(x => this.asPath(x?.path) || this.asPath(x?.tempFilePath))
	          .filter(p => typeof p === 'string' && p.length)
	      }
	    }
	    if (!tempPaths.length) {
	      uni.showToast({ title: '未获取到图片路径', icon: 'none' })
	      return
	    }
	    this.uploading = true
	    this.uploadProgress = 0
	    this.startFakeProgress()
		const totalCount = tempPaths.length
	
	    // 2) 逐个上传
	    for (let i = 0; i < tempPaths.length; i++) {
	      const filePath = tempPaths[i]
	
	      // ✅ 关键：filePath 必须是 string
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
	
	      // ✅ 关键：fileID 必须是 string，否则不要进入 getTempFileURL（否则继续 e3.split）
	      if (typeof fileID !== 'string' || !fileID) {
	        console.error('[upload] invalid fileID from uploadFile:', up)
	        uni.showToast({ title: '上传返回 fileID 异常', icon: 'none' })
	        continue
	      }
	
	      // 入库保存 fileID
	      this.form.cover_images.push(fileID)
	
	      // 3) 回显临时链接（只在 fileID 合法时调用）
	      try {
	        const tmp = await uniCloud.getTempFileURL({
	            fileList: [fileID] // ✅ 只传字符串数组
	        })
	        const url = tmp?.fileList?.[0]?.tempFileURL
	          if (typeof url === 'string' && url) {
	            this.$set(this.coverUrlMap, fileID, url)
	          }
	        } catch (e) {
	          console.error('getTempFileURL failed:', e)
	        }
	
	      const doneCount = i + 1
		  this.uploadProgress = Math.min(99,Math.floor((doneCount / totalCount) * 100))
	    }
		this.finishProgressAndHide()
	  } catch (e) {
	    uni.showToast({ title: e?.message || '选择/上传失败', icon: 'none' })
	  } finally {
		this.stopFakeProgress()
		this.hasRealTotal = false
	  }
	},
	
	startFakeProgress() {
	  this.stopFakeProgress()
	  this.hasRealTotal = false
	
	  // 从 1% 开始更“像在动”
	  if (this.uploadProgress <= 0) this.uploadProgress = 1
	
	  this.uploadTimer = setInterval(() => {
	    // 只在“没有真实 total”时模拟
	    if (this.hasRealTotal) return
	
	    // 缓慢涨到 95%，留 5% 给完成时跳 100
	    if (this.uploadProgress < 95) {
	      // 越往后越慢
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
	  // 结束时统一收尾：先到 100，再稍等一下再归零/隐藏
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
	
	// 从 uploadFile 返回里“强行提取 string 类型 fileID”，提不到就返回 ''
	pickFileID(up) {
	  // 常见：{ fileID: 'cloud://xxx' }
	  if (typeof up?.fileID === 'string') return up.fileID
	
	  // 少数情况：{ fileId: '...' }
	  if (typeof up?.fileId === 'string') return up.fileId
	
	  // 极少数：fileID 是数组
	  if (Array.isArray(up?.fileID) && typeof up.fileID[0] === 'string') return up.fileID[0]
	
	  return ''
	},

    removeCover(i) {
      const fid = this.form.cover_images[i]
      this.form.cover_images.splice(i, 1)
      if (fid && this.coverUrlMap[fid]) this.$delete(this.coverUrlMap, fid)
    },

    addTag() {
      const t = (this.tagInput || '').trim()
      if (!t) return
      if (!this.form.tags.includes(t)) {
          this.form.tags.push(t)
          uni.hideKeyboard()
        }
      this.tagInput = ''
    },
    removeTag(i) {
      this.form.tags.splice(i, 1)
    },

    addIngredient() {
      const t = (this.ingInput || '').trim()
      if (!t) return
      this.form.ingredients.push(t)
      this.ingInput = ''
	  uni.hideKeyboard()
    },
    removeIngredient(i) {
      this.form.ingredients.splice(i, 1)
    },

    addStep() {
      const t = (this.stepInput || '').trim()
      if (!t) return
      this.form.steps.push(t)
      this.stepInput = ''
	  uni.hideKeyboard()
    },
    removeStep(i) {
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
        categoryId: (f.categoryId === 0 || f.categoryId === '0')? '0': String(f.categoryId ?? ''),
        categoryName: (f.categoryName || '').trim(),
        cover_images: Array.isArray(f.cover_images) ? f.cover_images.filter(x => typeof x === 'string' && x.trim()) : [],
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

    async onSubmit() {
      if (this.submitting || this.uploading) return

      const msg = this.validate()
      if (msg) {
        uni.showToast({ title: msg, icon: 'none' })
        return
      }

      const payload = this.normalizeForm(this.form)

      this.safeShowLoading('提交中...')
      try {
        this.submitting = true

        if (this.mode === 'edit') {
          await foodService.updateFood(this.foodId, payload)

          uni.setStorageSync('needRefreshFoodDetail', this.foodId)
          uni.setStorageSync('needRefreshFoods', 1)
		  this.safeHideLoading(true)

          uni.showToast({ title: '修改成功', icon: 'success' })
		  setTimeout(() => uni.navigateBack(), 150)
          return
        }

        await foodService.addFood(payload)
        uni.setStorageSync('needRefreshFoods', 1)
		this.safeHideLoading(true)
        uni.showToast({ title: '新增成功', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 150)
      } catch (e) {
        console.error(e)
        uni.showToast({ title: e?.message || '提交失败', icon: 'none' })
      } finally {
        this.safeHideLoading()
        this.submitting = false
      }
    },

    onCancel() {
      if (this.backLock) return
      if (this.isDirty()) {
        this.backLock = true
        uni.showModal({
          title: '提示',
          content: '内容尚未保存，确定要离开吗？',
          success: (res) => {
            if (res.confirm) {
              uni.navigateBack()
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
      uni.navigateBack()
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
