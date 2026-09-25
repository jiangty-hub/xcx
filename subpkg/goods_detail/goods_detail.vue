<template>
  <view class="detail-page" :class="{ 'has-actions': showActions }">
    <view v-if="loading" class="detail-state">菜品加载中...</view>
    <view v-else-if="loadError" class="detail-state">
      <text>{{ loadError }}</text>
      <button v-if="foodId" class="retry-btn" size="mini" @click="retryDetail">重试</button>
    </view>
    <block v-else>
      <view class="cover-frame">
        <swiper class="dish-swiper" :indicator-dots="dishImages.length > 1" :autoplay="dishImages.length > 1"
          :circular="dishImages.length > 1" :interval="3000" :duration="1000"
          indicator-color="rgba(255,255,255,0.7)" indicator-active-color="#E5A500">
          <swiper-item v-for="(item, i) in dishImages" :key="i">
            <image class="dish-images" :src="failedImages[i] ? '/static/cover-default.png' : fixImg(item)"
              mode="aspectFill" @error="onCoverError(i)" />
          </swiper-item>
        </swiper>
      </view>
      <view class="dish-main-card">
        <view class="dish-header">
          <view class="name-group">
            <text class="dish-name">{{ cid_info.name || '未命名菜品' }}</text>
            <image v-if="!badgeFailed" class="chef-badge" src="/static/detail/chef-badge.png" mode="aspectFit" @error="badgeFailed = true" />
          </view>
          <text v-if="categoryLabel" class="dish-category">{{ categoryLabel }}</text>
        </view>
        <view v-if="displayTags.length" class="dish-tags">
          <text v-for="(tag, index) in displayTags" :key="index" class="tag">{{ tag }}</text>
        </view>
        <view class="price-box">
          <text class="price-symbol">¥</text><text class="price-value">{{ formatPrice(cid_info.price) }}</text>
          <text class="tax">（税込）</text>
        </view>
        <view v-if="summaryText" class="dish-summary">{{ summaryText }}</view>
      </view>
      <view class="dish-attributes">
        <view class="attr-item"><text class="attr-icon">🌶️</text><text class="attr-label">口味</text><text class="attr-value">{{ displayText(cid_info.flavor) || '未填写' }}</text></view>
        <view class="attr-item"><text class="attr-icon">⏱️</text><text class="attr-label">时长</text><text class="attr-value">{{ timeLabel }}</text></view>
        <view class="attr-item"><text class="attr-icon">👨‍🍳</text><text class="attr-label">难度</text><text class="attr-value">{{ displayText(cid_info.difficulty) || '未填写' }}</text></view>
      </view>
      <view class="section-card">
        <view class="section-title"><text class="section-icon">🥘</text><text>食材清单</text></view>
        <view v-if="displayIngredients.length" class="ingredients-list">
          <view v-for="(item, index) in displayIngredients" :key="index" class="ingredient-item"><view class="ingredient-dot" /><text class="ingredient-name">{{ item }}</text></view>
        </view>
        <text v-else class="empty-text">暂未填写食材</text>
      </view>
      <view class="section-card">
        <view class="section-title"><text class="section-icon">📝</text><text>制作步骤</text></view>
        <view v-if="displaySteps.length" class="steps-list">
          <view v-for="(step, index) in displaySteps" :key="index" class="step-item"><view class="step-number">{{ index + 1 }}</view><text class="step-content">{{ step }}</text></view>
        </view>
        <text v-else class="empty-text">暂未填写步骤</text>
      </view>
      <view v-if="showActions" class="actions-dock">
        <view class="bottom-actions">
          <button class="action-btn delete-btn" :disabled="deleting" @click="onDelete"><view class="trash-icon"><view /></view><text>{{ deleting ? '删除中...' : '删除菜品' }}</text></button>
          <button class="action-btn edit-btn" :disabled="deleting" @click="onEdit"><text class="btn-icon">📝</text><text>修改菜品</text></button>
        </view>
      </view>
    </block>
  </view>
</template>

<script>
import { beginLoading } from '@/utils/loading.js'
import { applyNewToken, checkManagePermission, getAuthToken } from '@/utils/auth.js'
import { getResumeRefreshState } from '@/utils/resume-refresh.js'

const foodService = uniCloud.importObject('food-service', { customUI: true })

export default {
  data() {
    return {
      cid_info: {},
      foodId: '',
      loading: true,
      loadError: '',
      deleting: false,
      badgeFailed: false,
      failedImages: {},

      // ✅ 权限
      canManage: false,
      isFirstShow: true,
      lastResumeSeqHandled: 0
    }
  },

  async onLoad(options) {
    this.lastResumeSeqHandled = getResumeRefreshState(0).seq
    const id = options.id
    if (!id) {
      this.loading = false
      this.loadError = '缺少菜品id'
      return
    }
    this.foodId = id

    await this.getDishDetailById(id)
    await this.refreshPermission()
  },

  // 编辑页保存后返回详情页：自动刷新当前菜品
  async onShow() {
    const resume = getResumeRefreshState(this.lastResumeSeqHandled)
    if (resume.seq) this.lastResumeSeqHandled = resume.seq
    let refreshedOnResume = false
    if (resume.shouldRefresh && this.foodId) {
      await this.getDishDetailById(this.foodId)
      refreshedOnResume = true
    }

    const needId = uni.getStorageSync('needRefreshFoodDetail')
    if (needId && needId === this.foodId) {
      uni.removeStorageSync('needRefreshFoodDetail')
      if (!refreshedOnResume) await this.getDishDetailById(this.foodId)
    }
    // 首次进入时 onLoad 已校验权限，避免 onShow 再发一遍相同请求。
    if (this.isFirstShow) {
      this.isFirstShow = false
      return
    }
    // 返回详情页时刷新权限（例如用户刚登录或退出）。
    await this.refreshPermission()
  },

  computed: {
    showActions() { return !this.loading && !this.loadError && this.canManage },
    displayTags() { return this.textList(this.cid_info.tags) },
    displayIngredients() { return this.textList(this.cid_info.ingredients, true) },
    displaySteps() { return this.textList(this.cid_info.steps) },
    categoryLabel() { return this.displayText(this.cid_info.categoryName || this.cid_info.category) },
    summaryText() { return this.displayText(this.cid_info.summary) },
    timeLabel() {
      const value = this.cid_info.cook_time
      if (value === null || value === undefined || String(value).trim() === '') return '未填写'
      const minutes = Number(value)
      return Number.isFinite(minutes) && minutes >= 0 ? minutes + '分钟' : '未填写'
    },
    dishImages() {
      const u = this.cid_info?.cover_urls
      if (Array.isArray(u)) {
        const urls = u.filter(x => typeof x === 'string' && x.trim())
        if (urls.length) return urls
      }

      const b = this.cid_info?.cover_images
      if (Array.isArray(b) && b.length) {
        const httpOnly = b.map(String).filter((x) => x.startsWith('http'))
        if (httpOnly.length) return httpOnly
      }

      return ['/static/cover-default.png']
    }
  },

  methods: {
    displayText(value) { return typeof value === 'string' ? value.trim() : '' },
    textList(value, objects = false) {
      if (!Array.isArray(value)) return []
      return value.map(item => this.displayText(objects && item && typeof item === 'object' ? item.name : item)).filter(Boolean)
    },
    onCoverError(index) {
      if (!this.failedImages[index]) this.failedImages = { ...this.failedImages, [index]: true }
    },
    // ✅ 统一取 token：兼容不同项目里存 token 的 key
    getToken() {
      return getAuthToken()
    },

    // ✅ 刷新是否有“删除/修改”的权限
    async refreshPermission() {
      const token = this.getToken()
      if (!token) {
        this.canManage = false
        return
      }
      try {
        // 后端会校验：token 是否有效 + uid 是否在白名单
        const permission = await checkManagePermission(foodService, token)
        this.canManage = permission.canManage
      } catch (e) {
        this.canManage = false
        console.error('permission check failed:', e)
        uni.showToast({ title: e?.message || '权限校验失败，请稍后重试', icon: 'none' })
      }
    },

    // 调云对象拿详情（后端已补 cover_urls）
    async getDishDetailById(id) {
      try {
        this.loading = true
        this.loadError = ''
        const dish = await foodService.getFoodDetail(id)
        this.cid_info = dish || {}
        this.failedImages = {}
      } catch (err) {
        this.cid_info = {}
        this.loadError = err?.message || '未找到菜品'
        console.error(err)
      } finally {
        this.loading = false
      }
    },

    // 修正图片 url
    fixImg(url) {
      if (!url) return '/static/cover-default.png'
      let fixed = String(url).replace(/\s+/g, '')
      fixed = fixed.replace(/^https:\/*/i, 'https://')
      return fixed
    },

    formatPrice(price) {
      if (price === null || price === undefined || price === '') return '0'
      const value = Number(price)
      return Number.isFinite(value) ? String(value) : '0'
    },

    retryDetail() {
      if (this.foodId) this.getDishDetailById(this.foodId)
    },

    // 删除：删完回到分类页
    async onDelete() {
      if (!this.foodId || this.deleting) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限，请登录管理员账号', icon: 'none' })
        return
      }

      this.deleting = true
      uni.showModal({
        title: '确认删除',
        content: `确定要删除「${this.cid_info?.name || ''}」吗？`,
        confirmText: '删除',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (!res.confirm) {
            this.deleting = false
            return
          }
          const stopLoading = beginLoading('删除中...')
          try {

            const token = this.getToken()
            const result = await foodService.deleteFood(this.foodId, token) // ✅ 传 token 给后端校验
            applyNewToken(result)

            await stopLoading()
            const cleanup = result?.cleanup || {}
            if (cleanup.error || cleanup.skipped) {
              uni.showToast({ title: '菜品已删除，部分旧图片未清理', icon: 'none' })
            }

            uni.setStorageSync('needRefreshFoods', 1)

            const pages = getCurrentPages()
            const idx = pages.findIndex((p) => p.route === 'pages/category/category')
            if (idx !== -1) {
              const delta = pages.length - 1 - idx
              uni.navigateBack({ delta })
            } else {
              uni.reLaunch({ url: '/pages/category/category' })
            }
          } catch (e) {
            await stopLoading()
            uni.showToast({ title: e?.message || '删除失败', icon: 'none' })
            console.error(e)
          } finally {
            await stopLoading()
            this.deleting = false
          }
        },
        fail: () => {
          this.deleting = false
        }
      })
    },

    // 修改：去编辑页
    onEdit() {
      if (!this.foodId || this.deleting) return
      if (!this.canManage) {
        uni.showToast({ title: '无权限，请登录管理员账号', icon: 'none' })
        return
      }
      uni.navigateTo({
        url: `/pages/addDish/addDish?mode=edit&id=${this.foodId}`
      })
    }
  }
}
</script>

<style>
page { background: #FFFBEB; }
</style>
<style scoped lang="scss">
.detail-page { --dock-height: 132rpx; min-height: 100vh; box-sizing: border-box; padding: 16rpx 0 calc(24rpx + env(safe-area-inset-bottom)); background: #FFFBEB; color: #382518; }
.detail-page.has-actions { padding-bottom: calc(var(--dock-height) + 28rpx + env(safe-area-inset-bottom)); }
.detail-state { min-height: 65vh; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 24rpx; padding: 32rpx; color: #938778; text-align: center; }
.retry-btn { background: #FFF0B3; color: #79521B; border-radius: 40rpx; }
.cover-frame { margin: 0 20rpx; border-radius: 32rpx; overflow: hidden; transform: translateZ(0); background: #F7ECCC; }
.dish-swiper { width: 100%; height: 400rpx; }
.dish-images { width: 100%; height: 100%; }
.dish-main-card, .dish-attributes, .section-card { margin: 18rpx 20rpx; border-radius: 34rpx; background: #FFFEF9; box-shadow: 0 8rpx 24rpx rgba(174,130,34,.055); }
.dish-main-card { position: relative; margin-top: -34rpx; padding: 22rpx 26rpx 24rpx; z-index: 1; }
.dish-header { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12rpx; }
.name-group { display: flex; align-items: center; flex: 1 1 360rpx; min-width: 0; gap: 10rpx; }
.dish-name { font-size: 46rpx; font-weight: 800; line-height: 1.3; overflow-wrap: anywhere; min-width: 0; }
.chef-badge { width: 100rpx; height: 108rpx; flex-shrink: 0; }
.dish-category { margin-top: 16rpx; max-width: 100%; box-sizing: border-box; padding: 10rpx 24rpx; border-radius: 40rpx; background: #FFE889; font-size: 26rpx; font-weight: 700; overflow-wrap: anywhere; }
.dish-tags { display: flex; flex-wrap: wrap; gap: 12rpx; margin: 4rpx 0 16rpx; }
.tag { padding: 9rpx 22rpx; border-radius: 36rpx; background: #FFF2C6; color: #F36C26; font-size: 26rpx; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }
.price-box { display: flex; align-items: baseline; flex-wrap: wrap; padding: 4rpx 0 14rpx; color: #FF692A; }
.price-symbol { font-size: 34rpx; font-weight: 700; }
.price-value { font-size: 62rpx; font-weight: 800; line-height: 1.25; margin-right: 12rpx; overflow-wrap: anywhere; max-width: 100%; }
.tax { color: #938778; font-size: 25rpx; }
.dish-summary { padding: 20rpx; border-left: 5rpx solid #E9AA00; border-radius: 12rpx; background: #FCF6DF; color: #857A6D; font-size: 28rpx; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.dish-attributes { display: flex; padding: 24rpx 6rpx; }
.attr-item { flex: 1; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 8rpx; padding: 0 12rpx; text-align: center; }
.attr-item + .attr-item::before { content: ''; position: absolute; top: 22rpx; bottom: 16rpx; left: 0; width: 1rpx; background: #EEE2C9; }
.attr-icon { font-size: 48rpx; line-height: 1.2; }
.attr-label { color: #97897B; font-size: 26rpx; }
.attr-value { font-size: 28rpx; font-weight: 700; line-height: 1.45; max-width: 100%; overflow-wrap: anywhere; }
.section-card { padding: 24rpx 26rpx; }
.section-title { display: flex; align-items: center; gap: 18rpx; padding-bottom: 18rpx; margin-bottom: 20rpx; border-bottom: 1rpx solid #EEE4CF; font-size: 34rpx; font-weight: 800; }
.section-icon { font-size: 38rpx; }
.ingredients-list { display: flex; flex-wrap: wrap; gap: 16rpx; }
.ingredient-item { display: flex; align-items: center; gap: 12rpx; padding: 13rpx 22rpx; border-radius: 40rpx; background: #FFF3C7; max-width: 100%; box-sizing: border-box; }
.ingredient-dot { width: 12rpx; height: 12rpx; flex-shrink: 0; border-radius: 50%; background: #E6A000; }
.ingredient-name { font-size: 28rpx; min-width: 0; overflow-wrap: anywhere; }
.steps-list { display: flex; flex-direction: column; gap: 22rpx; }
.step-item { display: flex; align-items: flex-start; gap: 24rpx; }
.step-number { min-width: 54rpx; height: 54rpx; padding: 0 6rpx; box-sizing: border-box; border-radius: 30rpx; background: #E9A900; color: white; display: flex; align-items: center; justify-content: center; font-size: 30rpx; font-weight: 700; flex-shrink: 0; }
.step-content { flex: 1; min-width: 0; padding-top: 5rpx; font-size: 29rpx; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.empty-text { color: #A09484; font-size: 26rpx; line-height: 1.6; }
/* The opaque dock covers the safe area; the page reserves the same total height. */
.actions-dock { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; height: calc(var(--dock-height) + env(safe-area-inset-bottom)); box-sizing: border-box; padding: 8rpx 20rpx calc(8rpx + env(safe-area-inset-bottom)); background: #FFFBEB; }
.bottom-actions { height: 116rpx; box-sizing: border-box; padding: 14rpx; border-radius: 34rpx; display: flex; gap: 16rpx; background: #FFFEF9; box-shadow: 0 -4rpx 24rpx rgba(174,130,34,.05); }
.action-btn { margin: 0; min-width: 0; height: 88rpx; padding: 0 8rpx; box-sizing: border-box; border-radius: 44rpx; display: flex; align-items: center; justify-content: center; gap: 12rpx; font-size: 29rpx; font-weight: 700; line-height: 1.3; }
.action-btn::after { border: 0; }
.delete-btn { flex: 0.85; border: 2rpx solid #FF692A; color: #FF692A; background: #FFFEF9; }
.edit-btn { flex: 1.15; color: #382518; background: linear-gradient(110deg, #FFE998, #FFDF65); }
.action-btn[disabled] { opacity: .55; }
.btn-icon { font-size: 36rpx; }
.trash-icon { position: relative; width: 23rpx; height: 29rpx; border: 3rpx solid currentColor; border-top: 0; border-radius: 0 0 4rpx 4rpx; box-sizing: border-box; margin: 7rpx 4rpx 0; }
.trash-icon::before { content: ''; position: absolute; top: -6rpx; left: -6rpx; width: 29rpx; border-top: 3rpx solid currentColor; }
.trash-icon::after { content: ''; position: absolute; width: 9rpx; height: 5rpx; border: 3rpx solid currentColor; border-bottom: 0; top: -12rpx; left: 4rpx; }
.trash-icon view { height: 16rpx; width: 5rpx; margin: 5rpx auto 0; border-left: 2rpx solid currentColor; border-right: 2rpx solid currentColor; }
</style>
