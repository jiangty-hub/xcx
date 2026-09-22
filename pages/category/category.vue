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
            @click="!loadingCategories && activeChanged(i)"
          >
            {{ item.name }}
          </view>
        </block>
      </scroll-view>

      <!--右侧菜品区域-->
      <scroll-view
        scroll-y="true"
        :style="{ height: wh + 'px' }"
        :scroll-top="scrollTop"
        :lower-threshold="80"
        @scrolltolower="loadMoreFoods"
      >
        <view v-if="loadingCategories || (!categoriesLoaded && !categoryError)" class="state-view">分类加载中...</view>
        <view v-else-if="categoryError" class="state-view error-state">
          <text>{{ categoryError }}</text>
          <button size="mini" @click="getCateList">重试</button>
        </view>
        <view v-else-if="!cateList.length" class="state-view">暂无分类</view>
        <view v-else-if="loadingFoods && !cateLevel.length" class="state-view">菜品加载中...</view>
        <view v-else-if="foodError && !cateLevel.length" class="state-view error-state">
          <text>{{ foodError }}</text>
          <button size="mini" @click="retryFoods">重试</button>
        </view>
        <view v-else-if="!cateLevel.length" class="state-view">该分类暂无菜品</view>
        <view v-else class="right-scroll-view">
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
          <view class="list-footer" v-if="loadingFoods">加载更多...</view>
          <view class="list-footer" v-else-if="!foodHasMore">已经到底了</view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script>
import { getResumeRefreshState } from '@/utils/resume-refresh.js'

const foodService = uniCloud.importObject('food-service', { customUI: true })
// 请求任务不参与页面渲染；每个页面实例独立保存。
const requestStates = new WeakMap()

export default {
  data() {
    return {
      wh: 0,
      active: 0,
      cateList: [],
      loadingCategories: false,
      categoriesLoaded: false,
      categoryError: '',
      cateLevel: [],
      scrollTop: 0,
      foodRequestSeq: 0,
      foodPage: 1,
      foodHasMore: false,
      loadingFoods: false,
      foodError: '',
      loadedCategoryId: '',
      lastResumeSeqHandled: 0
    }
  },

  async onLoad() {
    this.lastResumeSeqHandled = getResumeRefreshState(0).seq
    const sysInfo = uni.getWindowInfo()
    this.wh = sysInfo.windowHeight - 50
    await this.getCateList()
  },

  async onShow() {
    const resume = getResumeRefreshState(this.lastResumeSeqHandled)
    if (resume.seq) this.lastResumeSeqHandled = resume.seq
    if (resume.shouldRefresh) this.getRequestState().refreshVersion += 1
    // 与 onLoad 共用分类初始化和目标菜品请求，不先刷新原分类。
    await this.refresh({ force: false })
  },

  onUnload() {
    this.getRequestState().disposed = true
    this.foodRequestSeq += 1
  },

  methods: {
    getRequestState() {
      let state = requestStates.get(this)
      if (!state) {
        state = { categoriesTask: null, foodTask: null, refreshVersion: 0, confirmedVersion: 0, disposed: false }
        requestStates.set(this, state)
      }
      return state
    },

    // 展示封面：优先使用后端链接，兼容历史 HTTP 地址。
    getCover(food) {
      const defaultImg = '/static/cover-default.png'
      if (!food) return defaultImg
      if (Array.isArray(food.cover_urls) && food.cover_urls.length && food.cover_urls[0]) {
        return food.cover_urls[0]
      }
      if (Array.isArray(food.cover_images) && food.cover_images.length && food.cover_images[0]) {
        const first = String(food.cover_images[0])
        if (first.startsWith('http')) return first
      }
      return defaultImg
    },

    // 只解析并消费首页目标，不在这里发请求。无效目标回退第一分类。
    consumeSelectedCategoryIndex() {
      const selectedCategoryId = uni.getStorageSync('selectedCategoryId')
      const selectedCategory = uni.getStorageSync('selectedCategory')
      const hasCategoryId = selectedCategoryId !== undefined &&
        selectedCategoryId !== null && selectedCategoryId !== ''
      if (!hasCategoryId && !selectedCategory) return null

      const index = this.cateList.findIndex(item => hasCategoryId
        ? String(item.cate_id) === String(selectedCategoryId)
        : item.name === selectedCategory || String(item.name || '').replace(/类$/, '') === selectedCategory)
      uni.removeStorageSync('selectedCategoryId')
      uni.removeStorageSync('selectedCategory')
      return index < 0 ? 0 : index
    },

    // 模板重试和首次进入共用入口。
    getCateList() {
      return this.refresh({ force: false })
    },

    ensureCategories() {
      const state = this.getRequestState()
      if (state.disposed) return Promise.resolve(false)
      if (state.categoriesTask) return state.categoriesTask
      if (this.categoriesLoaded && !this.categoryError) return Promise.resolve(true)

      this.loadingCategories = true
      this.categoryError = ''
      // 延后到微任务执行，先登记任务，连同同步异常也能正确释放任务。
      const task = Promise.resolve().then(async () => {
        try {
          const categories = await foodService.getCategories()
          if (state.disposed) return false
          if (!Array.isArray(categories)) throw new Error('分类数据格式异常')
          this.cateList = categories
          this.categoriesLoaded = true
          return true
        } catch (err) {
          if (state.disposed) return false
          this.categoriesLoaded = false
          this.categoryError = '分类加载失败，请重试'
          console.error('get categories failed:', err)
          return false
        } finally {
          if (!state.disposed) this.loadingCategories = false
          if (state.categoriesTask === task) state.categoriesTask = null
        }
      })
      state.categoriesTask = task
      return task
    },

    // 合并恢复、修改刷新与首页跳转；失败时版本差保留刷新需求。
    async refresh({ force = true } = {}) {
      const state = this.getRequestState()
      if (state.disposed) return false
      if (force) state.refreshVersion += 1
      if (uni.getStorageSync('needRefreshFoods')) {
        state.refreshVersion += 1
        // 转为页面内待完成版本，不依赖易被其他入口重复消费的布尔标记。
        uni.removeStorageSync('needRefreshFoods')
      }
      if (!await this.ensureCategories() || state.disposed) return false
      if (!this.cateList.length) return true

      const selected = this.consumeSelectedCategoryIndex()
      const index = selected === null ? (this.cateList[this.active] ? this.active : 0) : selected
      return this.activeChanged(index)
    },

    activeChanged(i) {
      const state = this.getRequestState()
      const category = this.cateList[i]
      if (state.disposed || !category) return Promise.resolve(false)
      const cateId = String(category.cate_id)
      const changed = String(this.cateList[this.active]?.cate_id) !== cateId
      if (changed) {
        // 目标与列表归属一起切换，旧响应由序号拦截，旧列表不能当成新分类。
        this.active = i
        this.cateLevel = []
        this.loadedCategoryId = ''
        this.foodPage = 1
        this.foodHasMore = false
        this.foodError = ''
        this.scrollTop = this.scrollTop === 0 ? 1 : 0
      }
      if (this.loadedCategoryId === cateId && state.confirmedVersion === state.refreshVersion) {
        return Promise.resolve(true)
      }
      return this.loadFoodsByCategory(cateId)
    },

    loadFoodsByCategory(cateId, { append = false } = {}) {
      const state = this.getRequestState()
      const categoryId = String(cateId)
      if (state.disposed || String(this.cateList[this.active]?.cate_id) !== categoryId) {
        return Promise.resolve(false)
      }
      if (append && (this.loadingFoods || !this.foodHasMore || this.loadedCategoryId !== categoryId ||
          state.confirmedVersion !== state.refreshVersion)) return Promise.resolve(false)

      const page = append ? this.foodPage + 1 : 1
      const current = state.foodTask
      if (current && current.categoryId === categoryId && current.page === page &&
          current.refreshVersion === state.refreshVersion) return current.promise

      const request = { categoryId, page, append, refreshVersion: state.refreshVersion, seq: ++this.foodRequestSeq }
      state.foodTask = request
      this.loadingFoods = true
      if (!append) this.foodError = ''
      request.promise = this.performFoodRequest(request)
      return request.promise
    },

    async performFoodRequest(request) {
      const state = this.getRequestState()
      const isCurrent = () => !state.disposed && request.seq === this.foodRequestSeq &&
        String(this.cateList[this.active]?.cate_id) === request.categoryId
      try {
        const result = await foodService.getFoodsByCategory(request.categoryId, { page: request.page, pageSize: 30 })
        if (!isCurrent()) return false
        const list = Array.isArray(result) ? result : (result?.list || [])
        if (!Array.isArray(list)) throw new Error('菜品数据格式异常')
        this.cateLevel = request.append ? [...this.cateLevel, ...list] : list
        this.foodPage = request.page
        this.foodHasMore = Array.isArray(result) ? false : !!result?.hasMore
        this.foodError = ''
        this.loadedCategoryId = request.categoryId
        if (!request.append) {
          state.confirmedVersion = request.refreshVersion
          this.scrollTop = this.scrollTop === 0 ? 1 : 0
        }
        return true
      } catch (err) {
        if (!isCurrent()) return false
        if (!request.append && !this.cateLevel.length) {
          this.foodError = err?.message || '菜品加载失败'
        } else {
          this.$showError(err, request.append ? '加载更多失败' : '菜品加载失败', 1500)
        }
        return false
      } finally {
        if (isCurrent()) this.loadingFoods = false
        if (state.foodTask === request) state.foodTask = null
      }
    },

    loadMoreFoods() {
      const raw = this.cateList[this.active]?.cate_id
      if (raw === null || raw === undefined) return Promise.resolve(false)
      return this.loadFoodsByCategory(String(raw), { append: true })
    },

    retryFoods() {
      if (this.loadingCategories || this.loadingFoods) return
      return this.refresh()
    },

    gotoGoodsDetail(food) {
      uni.navigateTo({ url: '/subpkg/goods_detail/goods_detail?id=' + food._id })
    },

    gotoSearch() {
      uni.navigateTo({ url: '/subpkg/search/search' })
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

.state-view {
  min-height: 360rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  color: #999;
  font-size: 28rpx;
}

.error-state {
  color: #666;
}

.list-footer {
  width: 100%;
  padding: 12rpx 0 28rpx;
  text-align: center;
  color: #999;
  font-size: 24rpx;
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
