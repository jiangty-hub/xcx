<template>
  <view class="page">
    <!-- 菜品轮播图 -->
    <swiper class="dish-swiper" :indicator-dots="true" :autoplay="true" :interval="3000" :duration="1000" :circular="true" indicator-color="rgba(255, 255, 255, 0.5)" indicator-active-color="#ff6b35">
      <swiper-item v-for="(item, i) in dishImages" :key="i">
        <image class="dish-images" :src="fixImg(item)" mode="aspectFill"></image>
      </swiper-item>
    </swiper>

    <!-- 菜品主要信息 -->
    <view class="dish-main-card">
      <view class="dish-header">
        <view class="dish-name">{{ cid_info.name }}</view>
        <view class="dish-category">{{ cid_info.categoryName || cid_info.category || '' }}</view>
      </view>

      <view class="dish-tags">
        <text class="tag" v-for="(tag, index) in (cid_info.tags || [])" :key="index">{{ tag }}</text>
      </view>

      <view class="dish-price-row">
        <view class="price-box">
          <text class="price-symbol">¥</text>
          <text class="price-value">{{ formatPrice(cid_info.price) }}</text>
          <text class="tax">（税込）</text>
        </view>
      </view>

      <view class="dish-summary">{{ cid_info.summary }}</view>
    </view>

    <!-- 菜品属性 -->
    <view class="dish-attributes">
      <view class="attr-item">
        <view class="attr-icon">🌶️</view>
        <view class="attr-label">口味</view>
        <view class="attr-value">{{ cid_info.flavor }}</view>
      </view>
      <view class="attr-item">
        <view class="attr-icon">⏱️</view>
        <view class="attr-label">时长</view>
        <view class="attr-value">{{ cid_info.cook_time }}分钟</view>
      </view>
      <view class="attr-item">
        <view class="attr-icon">👨‍🍳</view>
        <view class="attr-label">难度</view>
        <view class="attr-value">{{ cid_info.difficulty }}</view>
      </view>
    </view>

    <!-- 食材清单 -->
    <view class="section-card">
      <view class="section-title">
        <view class="title-text">🥘 食材清单</view>
      </view>
      <view class="ingredients-list">
        <view class="ingredient-item" v-for="(item, index) in (cid_info.ingredients || [])" :key="index">
          <view class="ingredient-dot"></view>
          <text class="ingredient-name">{{ item.name || item }}</text>
        </view>
      </view>
    </view>

    <!-- 制作步骤 -->
    <view class="section-card">
      <view class="section-title">
        <view class="title-text">📝 制作步骤</view>
      </view>
      <view class="steps-list">
        <view class="step-item" v-for="(step, index) in (cid_info.steps || [])" :key="index">
          <view class="step-number">{{ index + 1 }}</view>
          <view class="step-content">{{ step }}</view>
        </view>
      </view>
    </view>

    <!-- 底部操作按钮 -->
    <view class="bottom-actions">
      <view class="action-btn collect-btn" @click="onDelete">
        <text class="btn-icon">🗑️</text>
        <text class="btn-text">删除菜品</text>
      </view>
      <view class="action-btn primary-btn" @click="onEdit">
        <text class="btn-icon">📝</text>
        <text class="btn-text">修改菜品</text>
      </view>
    </view>
  </view>
</template>

<script>
const foodService = uniCloud.importObject('food-service')

export default {
  data() {
    return {
      cid_info: {},
      foodId: '',
      loading: false
    }
  },

  async onLoad(options) {
    const id = options.id
    if (!id) {
      uni.showToast({ title: '缺少菜品id', icon: 'none' })
      return
    }
    this.foodId = id
    await this.getDishDetailById(id)
  },

  // 编辑页保存后返回详情页：自动刷新当前菜品
  async onShow() {
    const needId = uni.getStorageSync('needRefreshFoodDetail')
    if (needId && needId === this.foodId) {
      uni.removeStorageSync('needRefreshFoodDetail')
      await this.getDishDetailById(this.foodId)
    }
  },

  computed: {
    /**
     * ✅ 改动点：
     * - 现在后端 getFoodDetail 会返回 cover_urls（展示用临时链接数组）
     * - 轮播优先：images -> cover_urls -> 兼容旧的 cover_images(http url) -> []
     */
    dishImages() {
      const a = this.cid_info?.images
      if (Array.isArray(a) && a.length) return a

      const u = this.cid_info?.cover_urls
      if (Array.isArray(u) && u.length) return u

      // 兼容旧数据：cover_images 里存的是 http(s) url
      const b = this.cid_info?.cover_images
      if (Array.isArray(b) && b.length) {
        const httpOnly = b.map(String).filter((x) => x.startsWith('http'))
        if (httpOnly.length) return httpOnly
      }

      return []
    }
  },

  methods: {
    // 调云对象拿详情（后端已补 cover_urls）
    async getDishDetailById(id) {
      try {
        this.loading = true
        const dish = await foodService.getFoodDetail(id)
        this.cid_info = dish || {}
      } catch (err) {
        uni.showToast({ title: '未找到菜品', icon: 'none' })
        console.error(err)
      } finally {
        this.loading = false
      }
    },

    // 修正图片 url（兼容旧 url；cover_urls 一般不需要修，但保留无害）
    fixImg(url) {
      if (!url) return '/static/cover-default.png'
      let fixed = String(url).replace(/\s+/g, '')
      fixed = fixed.replace(/^https:\/*/i, 'https://')
      return fixed
    },

    formatPrice(price) {
      return price || '000'
    },

    // 删除：删完回到分类页
    async onDelete() {
      if (!this.foodId) return

      uni.showModal({
        title: '确认删除',
        content: `确定要删除「${this.cid_info?.name || ''}」吗？`,
        confirmText: '删除',
        confirmColor: '#ff4d4f',
        success: async (res) => {
          if (!res.confirm) return
          try {
            uni.showLoading({ title: '删除中...' })
            await foodService.deleteFood(this.foodId)
            uni.hideLoading()

            // 通知分类页刷新
            uni.setStorageSync('needRefreshFoods', 1)

            // 回分类页：优先回退到栈内的分类页，否则重启到分类页
            const pages = getCurrentPages()
            const idx = pages.findIndex((p) => p.route === 'pages/category/category')
            if (idx !== -1) {
              const delta = pages.length - 1 - idx
              uni.navigateBack({ delta })
            } else {
              uni.reLaunch({ url: '/pages/category/category' })
            }
          } catch (e) {
            uni.hideLoading()
            uni.showToast({ title: e?.message || '删除失败', icon: 'none' })
            console.error(e)
          }
        }
      })
    },

    // 修改：去编辑页（新增页）
    onEdit() {
      if (!this.foodId) return
      uni.navigateTo({
        url: `/pages/addDish/addDish?mode=edit&id=${this.foodId}`
      })
    }
  }
}
</script>

<style lang="scss">
page {
  background: #f5f5f5;
}

.page {
  padding-bottom: 120rpx;
}

/* 轮播图样式 */
.dish-swiper {
  width: 100%;
  height: 500rpx;
  position: relative;
}

.dish-images {
  width: 100%;
  height: 100%;
}

/* 主要信息卡片 */
.dish-main-card {
  background: #fff;
  margin: -40rpx 20rpx 20rpx;
  border-radius: 24rpx;
  padding: 30rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.08);
  position: relative;
  z-index: 10;
}

.dish-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}

.dish-name {
  font-size: 40rpx;
  font-weight: bold;
  color: #333;
  flex: 1;
}

.dish-category {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  padding: 8rpx 20rpx;
  border-radius: 30rpx;
  font-size: 24rpx;
}

.dish-tags {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
  flex-wrap: wrap;
}

.tag {
  background: #fff3e0;
  color: #ff6b35;
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  font-size: 24rpx;
  border: 1rpx solid #ffecb3;
}

.dish-price-row {
  margin-bottom: 24rpx;
}

.price-box {
  display: flex;
  align-items: baseline;
}

.price-symbol {
  font-size: 32rpx;
  color: #ff6b35;
  font-weight: bold;
}

.price-value {
  font-size: 56rpx;
  color: #ff6b35;
  font-weight: bold;
  margin: 0 8rpx;
}

.tax {
  font-size: 24rpx;
  color: #999;
}

.dish-summary {
  color: #666;
  font-size: 28rpx;
  line-height: 1.6;
  padding: 20rpx;
  background: #f8f9fa;
  border-radius: 12rpx;
  border-left: 4rpx solid #ff6b35;
}

/* 属性标签 */
.dish-attributes {
  display: flex;
  justify-content: space-around;
  background: #fff;
  margin: 20rpx;
  border-radius: 24rpx;
  padding: 30rpx 20rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.08);
}

.attr-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.attr-icon {
  font-size: 48rpx;
}

.attr-label {
  font-size: 24rpx;
  color: #999;
}

.attr-value {
  font-size: 28rpx;
  color: #333;
  font-weight: 600;
}

/* 通用卡片样式 */
.section-card {
  background: #fff;
  margin: 20rpx;
  border-radius: 24rpx;
  padding: 30rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.08);
}

.section-title {
  margin-bottom: 24rpx;
  padding-bottom: 20rpx;
  border-bottom: 2rpx solid #f0f0f0;
}

.title-text {
  font-size: 32rpx;
  font-weight: bold;
  color: #333;
}

/* 食材清单 */
.ingredients-list {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx;
}

.ingredient-item {
  display: flex;
  align-items: center;
  background: #f8f9fa;
  padding: 16rpx 24rpx;
  border-radius: 30rpx;
  gap: 12rpx;
}

.ingredient-dot {
  width: 12rpx;
  height: 12rpx;
  background: #ff6b35;
  border-radius: 50%;
}

.ingredient-name {
  font-size: 28rpx;
  color: #333;
}

/* 制作步骤 */
.steps-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.step-item {
  display: flex;
  gap: 20rpx;
  align-items: flex-start;
}

.step-number {
  width: 48rpx;
  height: 48rpx;
  background: linear-gradient(135deg, #ff6b35 0%, #ff8c61 100%);
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: bold;
  flex-shrink: 0;
}

.step-content {
  flex: 1;
  font-size: 28rpx;
  color: #666;
  line-height: 1.8;
  padding-top: 8rpx;
}

/* 底部操作按钮 */
.bottom-actions {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #fff;
  padding: 20rpx;
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.08);
  display: flex;
  gap: 20rpx;
  z-index: 100;
}

.action-btn {
  height: 88rpx;
  border-radius: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.collect-btn {
  width: 180rpx;
  background: #f8f9fa;
  color: #666;
  border: 2rpx solid #e0e0e0;
}

.btn-icon {
  font-size: 32rpx;
}

.primary-btn {
  flex: 1;
  background: linear-gradient(135deg, #ff6b35 0%, #ff8c61 100%);
  color: #fff;
  box-shadow: 0 8rpx 16rpx rgba(255, 107, 53, 0.3);
}

.btn-text {
  font-size: 28rpx;
}
</style>
