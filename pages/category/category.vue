<template>
  <view>
    <!--使用自定义的搜索组件-->
    <my-search @click="gotoSearch"></my-search>

    <view class="scroll-view-container">
      <!--左侧分类区域-->
      <scroll-view class="left-srcoll-view" scroll-y="true" :style="{ height: wh + 'px' }">
        <block v-for="(item, i) in cateList" :key="i">
          <view
            :class="['left-scroll-view-item', i === active ? 'active' : '']"
            @click="activeChanged(i)"
          >
            {{ item.name }}
          </view>
        </block>
      </scroll-view>

      <!--右侧菜品区域-->
      <scroll-view scroll-y="true" :style="{ height: wh + 'px' }" :scroll-top="scrollTop">
        <view class="right-scroll-view">
          <view
            class="right-scroll-view-item"
            v-for="(item, i2) in cateLevel"
            :key="item._id || i2"
            @click="gotoGoodsDetail(item)"
          >
            <!-- 改：优先使用后端返回的 cover_urls[0] 作为展示封面 -->
            <image :src="getCover(item)" class="item-image" mode="aspectFill"></image>

            <text class="item-text">{{ item.name }}</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
const foodService = uniCloud.importObject('food-service')

export default {
  data() {
    return {
      wh: 0,
      active: 0,
      cateList: [],
      cateLevel: [],
      scrollTop: 0,
      foodRequestSeq: 0
    }
  },

  async onLoad() {
    const sysInfo = uni.getWindowInfo()
    this.wh = sysInfo.windowHeight - 50
    await this.getCateList()
  },

  // 从详情页回来（删/改）会触发 onShow，这里自动刷新
  async onShow() {
    const need = uni.getStorageSync('needRefreshFoods')
    if (need) {
      uni.removeStorageSync('needRefreshFoods')
      await this.refresh()
    }
    this.applySelectedCategoryFromStorage()
  },

  methods: {
    // ✅ 封面兜底：
    // 1) 新接口：food.cover_urls[0]（临时链接，可直接展示）
    // 2) 兼容旧数据：food.cover_images[0]（历史可能是 http url）
    // 3) 默认图
    getCover(food) {
      const defaultImg = '/static/cover-default.png'

      if (!food) return defaultImg

      // 新后端返回：cover_urls（推荐）
      if (Array.isArray(food.cover_urls) && food.cover_urls.length > 0 && food.cover_urls[0]) {
        return food.cover_urls[0]
      }

      // 兼容：旧数据 cover_images 里存的是 http(s) url
      if (Array.isArray(food.cover_images) && food.cover_images.length > 0 && food.cover_images[0]) {
        const first = String(food.cover_images[0])
        if (first.startsWith('http')) return first
      }

      return defaultImg
    },

    // 从 storage 读取 home 传来的分类，并切换
    async applySelectedCategoryFromStorage() {
      // 你这里用的是 wx.getStorageSync，我保持不动（在小程序端没问题）
      const selectedCategory = wx.getStorageSync('selectedCategory')
      if (!selectedCategory) return
      if (!this.cateList || this.cateList.length === 0) return

      const index = this.cateList.findIndex(
        (item) => item.name === selectedCategory || item.name.replace(/类$/, '') === selectedCategory
      )

      if (index !== -1) {
        await this.activeChanged(index)
      }
      wx.removeStorageSync('selectedCategory')
    },

    // 获取分类列表数组
    async getCateList() {
      try {
        const categories = await foodService.getCategories()
        this.cateList = categories || []

        // 默认加载第一个分类的右侧菜品
        if (this.cateList.length > 0) {
          const firstCateId = String(this.cateList[0].cate_id)
          await this.loadFoodsByCategory(firstCateId)
        }

        // 如果 home 传了 selectedCategory，优先切换到对应分类
        await this.applySelectedCategoryFromStorage()
      } catch (err) {
        this.$showError(err, '分类加载失败', 1500)
      }
    },

    // 获取右侧菜品
    async loadFoodsByCategory(cateId) {
      const requestSeq = ++this.foodRequestSeq
      try {
        const foods = await foodService.getFoodsByCategory(String(cateId))
        if (requestSeq !== this.foodRequestSeq) return false
        this.cateLevel = foods || []
        return true
      } catch (err) {
        if (requestSeq !== this.foodRequestSeq) return false
        this.$showError(err, '菜品加载失败', 1500)
        return false
      }
    },

    // 左侧切换
    async activeChanged(i) {
      this.active = i
      const cateId = String(this.cateList[i].cate_id)
      const loaded = await this.loadFoodsByCategory(cateId)
      if (!loaded || i !== this.active) return
      // 让右侧滚动条回到顶部
      this.scrollTop = this.scrollTop === 0 ? 1 : 0
    },

    // 给详情页删除成功后调用/以及 onShow 自动刷新用
    async refresh() {
      if (!this.cateList || this.cateList.length === 0) {
        await this.getCateList()
        return
      }
      const raw = this.cateList[this.active]?.cate_id
      if (raw === null || raw === undefined) return
      const loaded = await this.loadFoodsByCategory(String(raw))
      if (!loaded) return
      this.scrollTop = this.scrollTop === 0 ? 1 : 0
    },

    // 跳转到菜品详细页面
    gotoGoodsDetail(food) {
      uni.navigateTo({
        url: '/subpkg/goods_detail/goods_detail?id=' + food._id
      })
    },

    // 跳转到 search 页面
    gotoSearch() {
      uni.navigateTo({
        url: '/subpkg/search/search'
      })
    }
  }
}
</script>

<style lang="scss">
.scroll-view-container {
  display: flex;
}

.left-srcoll-view {
  width: 200rpx;
  flex-shrink: 0;

  .left-scroll-view-item {
    background-color: #f7f7f7;
    line-height: 100rpx;
    text-align: center;
    font-size: 28rpx;

    &.active {
      background-color: #ffffff;
      position: relative;

      &::before {
        content: ' ';
        display: block;
        width: 6rpx;
        height: 50rpx;
        background-color: #c00000;
        position: absolute;
        top: 50%;
        left: 0;
        transform: translateY(-50%);
      }
    }
  }
}

.right-scroll-view {
  display: flex;
  flex-wrap: wrap;
  padding: 20rpx; /* 整体内边距 */
  justify-content: space-between; /* 两端对齐 */
}

.right-scroll-view-item {
  width: 48%; /* 每行两个，留2%间距 */
  margin-bottom: 30rpx; /* 底部间距 */
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.item-image {
  width: 100%; /* 占满父容器 */
  height: 240rpx; /* 固定高度 */
  object-fit: cover;
  border-radius: 12rpx;
  display: block;
}

.item-text {
  margin-top: 12rpx;
  text-align: center;
  font-size: 26rpx;
  line-height: 1.3;
  word-break: break-all;
  width: 100%;
}
</style>
