<template>
  <view class="category-page" :style="windowHeight ? { height: windowHeight + 'px' } : {}">
    <view class="category-header">
      <image class="category-hero" src="/static/category/category-hero.png" mode="aspectFit" aria-label="菜品分类，好吃的都在这里！" />
      <button class="category-search" hover-class="category-search-pressed" @click="gotoSearch">
        <view class="category-search-symbol" aria-hidden="true"></view>
        <text>搜搜想吃的菜</text>
      </button>
    </view>

    <view class="category-workspace">
      <view class="category-sidebar">
        <scroll-view scroll-y :style="{ height: wh + 'px' }" :scroll-into-view="navTarget" :show-scrollbar="false">
          <view class="category-nav-list">
            <view v-for="(item, i) in cateList" :key="item._id || item.cate_id" :id="'category-entry-' + i" class="category-nav-row">
              <button :class="['category-nav-button', { 'is-active': i === active }]" :disabled="loadingCategories" hover-class="category-nav-pressed" @click="activeChanged(i)">
                <view v-if="i === active" class="category-paw" aria-hidden="true"><view class="toe one"></view><view class="toe two"></view><view class="toe three"></view><view class="toe four"></view><view class="pad"></view></view>
                <text>{{ item.name }}</text>
              </button>
            </view>
          </view>
        </scroll-view>
      </view>

      <view class="category-main">
        <view class="category-title-slot">
          <view v-if="activeCategoryName" class="category-title-wrap">
            <text class="category-title">{{ activeCategoryName }}</text>
            <view class="category-underline" aria-hidden="true"></view>
          </view>
        </view>
        <view class="category-food-viewport">
          <scroll-view scroll-y :style="{ height: foodHeight + 'px' }" :scroll-top="scrollTop" :lower-threshold="80" @scrolltolower="loadMoreFoods">
            <view v-if="loadingCategories || (!categoriesLoaded && !categoryError)" class="category-state">分类加载中…</view>
            <view v-else-if="categoryError" class="category-state">
              <text>{{ categoryError }}</text><button size="mini" @click="getCateList">重试</button>
            </view>
            <view v-else-if="!cateList.length" class="category-state">暂无分类</view>
            <view v-else-if="loadingFoods && !cateLevel.length" class="category-state">菜品加载中…</view>
            <view v-else-if="foodError && !cateLevel.length" class="category-state">
              <text>{{ foodError }}</text><button size="mini" @click="retryFoods">重试</button>
            </view>
            <view v-else-if="!cateLevel.length" class="category-state">该分类暂无菜品</view>
            <view v-else class="category-food-content">
              <view class="category-food-grid">
                <button v-for="(item, i) in cateLevel" :key="item._id || i" class="category-food-card" hover-class="category-card-pressed" @click="gotoGoodsDetail(item)">
                  <view class="category-food-image"><view class="category-image-inner"><home-picture :src="getCover(item)" /></view></view>
                  <view class="category-food-caption"><text>{{ item.name }}</text></view>
                </button>
              </view>
              <view v-if="loadingFoods" class="category-footer">加载更多…</view>
              <view v-else-if="!foodHasMore" class="category-footer">
                <text>已经到底了</text>
                <view class="category-paw footer-paw" aria-hidden="true"><view class="toe one"></view><view class="toe two"></view><view class="toe three"></view><view class="toe four"></view><view class="pad"></view></view>
              </view>
            </view>
          </scroll-view>
        </view>
      </view>
    </view>
    <view class="category-bottom-space"></view>
  </view>
</template>

<script>
import HomePicture from '@/components/home/home-picture.vue'
import { syncTabBar } from '@/utils/tab-bar.js'
import { getResumeRefreshState } from '@/utils/resume-refresh.js'

const foodService = uniCloud.importObject('food-service', { customUI: true })
// 请求任务不参与页面渲染；每个页面实例独立保存。
const requestStates = new WeakMap()

export default {
  components: { HomePicture },
  data() {
    return {
      wh: 1,
      foodHeight: 1,
      windowHeight: 0,
      navTarget: '',
      layoutSeq: 0,
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

  computed: {
    activeCategoryName() {
      return this.categoriesLoaded && !this.categoryError ? (this.cateList[this.active]?.name || '') : ''
    }
  },

  async onLoad() {
    this.lastResumeSeqHandled = getResumeRefreshState(0).seq
    this.updateLayout()
    await this.getCateList()
  },

  onReady() {
    syncTabBar(this, 1)
    this.updateLayout()
  },
  async onShow() {
    syncTabBar(this, 1)
    this.updateLayout()
    const resume = getResumeRefreshState(this.lastResumeSeqHandled)
    if (resume.seq) this.lastResumeSeqHandled = resume.seq
    if (resume.shouldRefresh) this.getRequestState().refreshVersion += 1
    // 与 onLoad 共用分类初始化和目标菜品请求，不先刷新原分类。
    await this.refresh({ force: false })
  },

  onResize() {
    this.updateLayout()
  },

  onUnload() {
    this.layoutSeq += 1
    this.getRequestState().disposed = true
    this.foodRequestSeq += 1
  },

  methods: {
    updateLayout() {
      const state = this.getRequestState()
      if (state.disposed) return
      this.windowHeight = uni.getWindowInfo().windowHeight
      const seq = ++this.layoutSeq
      const measure = () => {
        if (state.disposed || seq !== this.layoutSeq || !uni.createSelectorQuery) return
        // 测量 flex 分配后的实际空间，安全区只在底部占位中扣除一次。
        const query = uni.createSelectorQuery().in(this)
        query.select('.category-sidebar').boundingClientRect()
        query.select('.category-food-viewport').boundingClientRect()
        query.exec(rects => {
          if (state.disposed || seq !== this.layoutSeq) return
          if (rects[0]) this.wh = Math.max(1, Math.floor(rects[0].height))
          if (rects[1]) this.foodHeight = Math.max(1, Math.floor(rects[1].height))
        })
      }
      if (this.$nextTick) this.$nextTick(measure)
    },

    revealCategory(index) {
      this.navTarget = ''
      const reveal = () => {
        if (!this.getRequestState().disposed) this.navTarget = 'category-entry-' + this.active
      }
      if (this.$nextTick) this.$nextTick(reveal)
      else this.navTarget = 'category-entry-' + index
    },

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
      this.revealCategory(i)
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

<style lang="scss" scoped>
.category-page { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #fffbeb; color: #35291e; box-sizing: border-box; }
.category-header { flex-shrink: 0; padding-bottom: 20rpx; }
.category-hero { display: block; width: 100%; height: 252rpx; }
.category-search { width: calc(100% - 56rpx); box-sizing: border-box; display: flex; align-items: center; height: 70rpx; margin: 8rpx 28rpx 0; padding: 0 32rpx; border-radius: 40rpx; background: #fff0bb; color: #998a75; font-size: 28rpx; line-height: 1.4; text-align: left; font-weight: 500; }
.category-search::after, .category-nav-button::after, .category-food-card::after { border: none; }
.category-search-pressed { background: #ffe9a2; }
.category-search-symbol { position: relative; flex-shrink: 0; width: 26rpx; height: 26rpx; margin-right: 28rpx; border: 4rpx solid #b88200; border-radius: 50%; }
.category-search-symbol::after { content: ''; position: absolute; right: -11rpx; bottom: -5rpx; width: 15rpx; height: 4rpx; background: #b88200; border-radius: 4rpx; transform: rotate(48deg); }
.category-workspace { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.category-sidebar { width: 208rpx; flex-shrink: 0; min-height: 0; overflow: hidden; border-radius: 0 26rpx 0 0; background: #fffefa; }
.category-nav-list { padding: 12rpx 10rpx 18rpx; }
.category-nav-row { padding: 8rpx 0; }
.category-nav-button { width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 78rpx; padding: 12rpx 6rpx; margin: 0; border-radius: 50rpx; background: transparent; color: #544b43; font-size: 29rpx; line-height: 1.4; font-weight: 400; word-break: break-all; }
.category-nav-button.is-active { background: #fff0bb; color: #49300e; font-weight: 700; }
.category-nav-button[disabled] { opacity: .65; }
.category-nav-pressed { background: #fff7d9; }
.category-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 0 20rpx 0 16rpx; }
.category-title-slot { height: 80rpx; flex-shrink: 0; display: flex; align-items: center; }
.category-title-wrap { max-width: 100%; }
.category-title { display: block; font-size: 38rpx; font-weight: 800; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.category-underline { width: 102rpx; height: 6rpx; margin-top: 4rpx; border-bottom: 4rpx solid #f6bf36; border-radius: 50%; }
.category-food-viewport { flex: 1; min-height: 0; overflow: hidden; }
.category-food-content { padding: 2rpx 0 16rpx; }
.category-food-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16rpx 14rpx; }
.category-food-card { width: 100%; min-width: 0; box-sizing: border-box; margin: 0; padding: 8rpx 8rpx 0; border-radius: 22rpx; background: #fffefa; box-shadow: 0 5rpx 16rpx rgba(155,112,30,.07); color: #241e19; }
.category-card-pressed { background: #fff0bb; }
.category-food-image { position: relative; width: 100%; padding-top: 100%; }
.category-image-inner { position: absolute; inset: 0; border-radius: 14rpx; overflow: hidden; }
.category-food-caption { display: flex; align-items: center; justify-content: center; min-height: 62rpx; padding: 8rpx 2rpx; box-sizing: border-box; }
.category-food-caption text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 26rpx; font-weight: 500; line-height: 1.4; word-break: break-all; }
.category-footer { display: flex; align-items: center; justify-content: center; padding: 32rpx 0 16rpx; color: #aaa394; font-size: 24rpx; }
.category-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20rpx; min-height: 220rpx; padding: 24rpx 12rpx; color: #998a75; font-size: 26rpx; text-align: center; box-sizing: border-box; }
.category-state button { margin: 0; background: #fff0bb; color: #916c22; }
.category-paw { position: relative; width: 36rpx; height: 36rpx; margin-right: 8rpx; flex-shrink: 0; color: #e9ac13; }
.toe, .pad { position: absolute; background: currentColor; }
.toe { width: 9rpx; height: 13rpx; border-radius: 50%; }
.one { left: 0; top: 10rpx; transform: rotate(-28deg); }
.two { left: 9rpx; top: 0; transform: rotate(-12deg); }
.three { right: 8rpx; top: 0; transform: rotate(12deg); }
.four { right: 0; top: 10rpx; transform: rotate(28deg); }
.pad { width: 22rpx; height: 20rpx; left: 7rpx; bottom: 0; border-radius: 55% 55% 40% 40%; }
.footer-paw { margin: 0 0 0 10rpx; transform: scale(.7); color: #b6af9e; }
.category-bottom-space { height: 16rpx; flex-shrink: 0;
  /* #ifdef MP-WEIXIN */
  height: calc(152rpx + env(safe-area-inset-bottom));
  /* #endif */
}
@media screen and (max-height: 580px) {
  .category-hero { height: 180rpx; }
  .category-header { padding-bottom: 12rpx; }
  .category-search { height: 62rpx; }
  .category-title-slot { height: 66rpx; }
}
</style>
