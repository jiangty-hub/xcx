<template>
  <view class="search-page">
    <view class="search-header">
      <view class="search-input-shell">
        <view class="search-glass" aria-hidden="true"></view>
        <input class="search-input" :value="kw" :focus="false" :maxlength="50" placeholder="请输入搜索内容" placeholder-class="search-placeholder" confirm-type="search" @input="onInput($event.detail.value)" @confirm="onConfirm" />
        <button v-if="kw" class="search-clear" aria-label="清空搜索内容" @click="onInput('')"><uni-icons type="clear" color="#998A75" :size="20" /></button>
      </view>
    </view>

    <view class="search-content">
      <view v-if="pendingSearch || loading" class="search-status" role="status">
        <view class="search-loading-dot"></view><text>{{ pendingSearch ? '正在准备搜索…' : '搜索中…' }}</text>
      </view>
      <view v-else-if="searchError" class="search-status">
        <text class="search-state-title">搜索未完成</text><text>{{ searchError }}</text>
        <button class="search-retry" size="mini" @click="retrySearch">重试</button>
      </view>
      <view v-else-if="searchResults.length">
        <view class="search-results">
          <button v-for="(item, i) in searchResults" :key="item._id || item.foodId || i" class="search-dish-card" hover-class="search-pressed" @click="gotoDetail(item)">
            <view class="search-dish-ratio"><view class="search-dish-image"><home-picture :src="getCover(item)" /></view></view>
            <view class="search-dish-caption"><text>{{ item.name }}</text></view>
          </button>
        </view>
        <view v-if="loadingMore" class="search-footer">加载更多…</view>
        <view v-else-if="!searchHasMore" class="search-footer">已经到底了</view>
      </view>
      <view v-else-if="hasSearched && kw.trim()" class="search-history-card">
        <view class="search-empty">
          <image class="search-empty-image" src="/static/search/search-empty.png" mode="aspectFit" />
          <text class="search-state-title">没有找到相关菜品</text>
          <text class="search-state-hint">换个关键词试试吧</text>
        </view>
      </view>
      <view v-else class="search-history-card">
        <view class="search-history-heading">
          <text>搜索历史</text>
          <button class="search-delete" :disabled="!histories.length" aria-label="清空搜索历史" @click="clean"><uni-icons type="trash" color="#837A70" :size="25" /></button>
        </view>
        <view v-if="histories.length" class="search-history-tags">
          <button v-for="item in histories" :key="item" class="search-history-tag" hover-class="search-pressed" @click="gotoHistory(item)">{{ item }}</button>
        </view>
        <view v-else class="search-empty">
          <image class="search-empty-image" src="/static/search/search-empty.png" mode="aspectFit" />
          <text class="search-state-title">暂无搜索历史</text>
          <text class="search-state-hint">搜搜今天想吃的菜吧</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import HomePicture from '@/components/home/home-picture.vue'
import { getResumeRefreshState } from '@/utils/resume-refresh.js'

export default {
  components: { HomePicture },
  data() {
    return {
      timer: null,
      pendingSearch: false,
      requestKeyword: '',
      searchSeq: 0,
      kw: '',
      searchResults: [],
      historyList: [],
      loading: false,
      loadingMore: false,
      hasSearched: false,
      searchError: '',
      searchPage: 1,
      searchHasMore: false,
      foodService: null,
      lastResumeSeqHandled: 0,
      refreshOnDetailReturn: false
    }
  },

  onLoad() {
    this.lastResumeSeqHandled = getResumeRefreshState(0).seq
  },

  async onShow() {
    try {
      const stored = uni.getStorageSync('kw')
      const parsed = typeof stored === 'string' ? JSON.parse(stored || '[]') : stored
      this.historyList = Array.isArray(parsed) ? [...new Set(parsed.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))].slice(-20) : []
    } catch (e) {
      this.historyList = []
      uni.removeStorageSync('kw')
    }

    const resume = getResumeRefreshState(this.lastResumeSeqHandled)
    if (resume.seq) this.lastResumeSeqHandled = resume.seq
    // 从详情返回和后台恢复合并为一次刷新，不消耗分类页的刷新标记。
    const shouldRefresh = this.refreshOnDetailReturn || resume.shouldRefresh
    this.refreshOnDetailReturn = false
    if (shouldRefresh && String(this.kw || '').trim()) {
      await this.submitSearch(this.kw, { force: true })
    }
  },

  onUnload() {
    clearTimeout(this.timer)
    this.timer = null
    this.pendingSearch = false
    this.searchSeq += 1
  },

  onReachBottom() {
    this.loadMoreResults()
  },

  created() {
    // 云对象实例
    this.foodService = uniCloud.importObject('food-service', { customUI: true })
  },

  methods: {
    onInput(val) {
      clearTimeout(this.timer)
      this.timer = null
      this.kw = typeof val === 'string' ? val : ''
      const seq = ++this.searchSeq
      this.searchResults = []
      this.searchError = ''
      this.loading = false
      this.loadingMore = false
      this.searchPage = 1
      this.searchHasMore = false
      this.hasSearched = false
      this.pendingSearch = false
      const keyword = this.kw.trim()
      if (!keyword) return
      if (keyword.length > 50) {
        this.searchError = '搜索关键词最长50字符，请缩短后重试'
        return
      }
      this.pendingSearch = true
      this.timer = setTimeout(() => {
        this.timer = null
        if (seq !== this.searchSeq) return
        this.pendingSearch = false
        this.search(seq)
      }, 400)
    },

    onConfirm(event) {
      uni.hideKeyboard()
      return this.submitSearch(event?.detail?.value ?? this.kw)
    },

    submitSearch(value, { force = false } = {}) {
      clearTimeout(this.timer)
      this.timer = null
      this.pendingSearch = false
      this.kw = typeof value === 'string' ? value : ''
      const keyword = this.kw.trim()
      if (!force && this.loading && this.requestKeyword === keyword) return
      this.searchPage = 1
      this.searchHasMore = false
      return this.search(++this.searchSeq)
    },

    async search(seq = ++this.searchSeq, { append = false } = {}) {
      if (seq !== this.searchSeq) return
      const keyword = (this.kw || '').trim()
      if (!keyword) {
        if (seq === this.searchSeq) {
          this.searchResults = []
          this.hasSearched = false
          this.searchError = ''
          this.loading = false
          this.loadingMore = false
          this.searchPage = 1
          this.searchHasMore = false
        }
        return
      }

      if (keyword.length > 50) {
        this.searchResults = []
        this.searchError = '搜索关键词最长50字符，请缩短后重试'
        this.searchHasMore = false
        this.loading = false
        this.loadingMore = false
        return
      }

      if (append) {
        if (this.pendingSearch || this.loading || this.loadingMore || !this.searchHasMore) return
        this.loadingMore = true
      } else {
        this.requestKeyword = keyword
        this.loading = true
        this.loadingMore = false
      }
      this.hasSearched = true
      if (!append) this.searchError = ''

      const page = append ? this.searchPage + 1 : 1
      const pageSize = 30

      try {
        // 后端已返回：cover_images(fileID数组) + cover_urls(临时链接数组)
        const result = await this.foodService.searchFoods(keyword, { page, pageSize })
        if (seq === this.searchSeq) {
          const list = Array.isArray(result)
            ? result
            : (Array.isArray(result?.list) ? result.list : [])
          const hasMore = Array.isArray(result)
            ? false
            : Boolean(result?.hasMore)

          if (append) {
            const seen = new Set(this.searchResults.map((item) => item._id || item.foodId).filter(Boolean))
            const additions = list.filter((item) => {
              const id = item && (item._id || item.foodId)
              if (!id || !seen.has(id)) {
                if (id) seen.add(id)
                return true
              }
              return false
            })
            this.searchResults = this.searchResults.concat(additions)
          } else {
            this.searchResults = list
            this.saveHistory(keyword)
          }
          this.searchPage = page
          this.searchHasMore = hasMore
        }
      } catch (e) {
        console.error(e)
        if (seq === this.searchSeq) {
          if (append) {
            uni.showToast({ title: e?.message || '加载更多失败', icon: 'none' })
          } else {
            this.searchResults = []
            this.searchHasMore = false
            this.searchError = e?.message || '搜索失败'
          }
        }
      } finally {
        if (seq === this.searchSeq) {
          if (append) this.loadingMore = false
          else this.loading = false
        }
      }
    },

    loadMoreResults() {
      return this.search(this.searchSeq, { append: true })
    },

    gotoDetail(item) {
      const id = item._id || item.foodId
      if (!id) {
        uni.showToast({ title: '缺少菜品ID', icon: 'none' })
        return
      }
      this.refreshOnDetailReturn = true
      uni.navigateTo({
        url: '/subpkg/goods_detail/goods_detail?id=' + id,
        fail: () => {
          this.refreshOnDetailReturn = false
          uni.showToast({ title: '打开菜品失败，请重试', icon: 'none' })
        }
      })
    },

    // 展示封面：优先 cover_urls[0]，兼容历史 cover_images 里是 http url 的情况
    getCover(item) {
      const defaultImg = '/static/cover-default.png'
      if (!item) return defaultImg

      const u = item.cover_urls
      if (Array.isArray(u) && u.length && u[0]) return u[0]

      const v = item.cover_images
      if (Array.isArray(v) && v.length && v[0]) {
        const first = String(v[0])
        if (first.startsWith('http')) return first
      }

      if (typeof v === 'string' && v) {
        const s = String(v)
        if (s.startsWith('http')) return s
      }

      return defaultImg
    },

    saveHistory(keyword) {
      const set = new Set(this.historyList)
      set.delete(keyword)
      set.add(keyword)
      this.historyList = Array.from(set).slice(-20)
      uni.setStorageSync('kw', JSON.stringify(this.historyList))
    },

    clean() {
      this.historyList = []
      uni.setStorageSync('kw', '[]')
    },

    gotoHistory(item) {
      uni.hideKeyboard()
      return this.submitSearch(item)
    },

    retrySearch() {
      return this.submitSearch(this.kw, { force: true })
    }
  },

  computed: {
    histories() {
      return [...this.historyList].reverse()
    }
  }
}
</script>

<style lang="scss" scoped>
.search-page { min-height: 100vh; box-sizing: border-box; background: #fffbeb; color: #35291e; padding-bottom: calc(32rpx + env(safe-area-inset-bottom)); }
.search-header { position: sticky; top: 0; z-index: 20; background: #fffbeb; padding: 22rpx 28rpx 24rpx; }
.search-input-shell { display: flex; align-items: center; height: 80rpx; border-radius: 44rpx; background: #fff0bb; padding: 0 28rpx 0 32rpx; }
.search-glass { position: relative; width: 29rpx; height: 29rpx; border: 4rpx solid #b88200; border-radius: 50%; margin-right: 28rpx; flex-shrink: 0; }
.search-glass::after { content: ''; position: absolute; right: -12rpx; bottom: -5rpx; width: 17rpx; height: 4rpx; border-radius: 4rpx; background: #b88200; transform: rotate(48deg); }
.search-input { flex: 1; min-width: 0; height: 76rpx; font-size: 30rpx; color: #35291e; }
.search-placeholder { color: #998a75; }
.search-clear, .search-delete { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 64rpx; height: 64rpx; padding: 0; margin: 0 -10rpx 0 6rpx; background: transparent; line-height: 1; }
.search-clear::after, .search-delete::after, .search-history-tag::after, .search-dish-card::after { border: none; }
.search-delete[disabled] { opacity: .65; background: transparent; }
.search-content { padding: 0 28rpx; }
.search-history-card { background: #fffefa; border-radius: 30rpx; box-shadow: 0 6rpx 24rpx rgba(155,112,30,.06); overflow: hidden; }
.search-history-heading { display: flex; align-items: center; justify-content: space-between; min-height: 94rpx; padding: 0 28rpx; border-bottom: 1rpx solid #f6f1e5; font-size: 32rpx; font-weight: 700; }
.search-empty { display: flex; flex-direction: column; align-items: center; padding: 42rpx 24rpx 52rpx; text-align: center; }
.search-empty-image { display: block; width: 350rpx; height: 310rpx; margin-bottom: 24rpx; }
.search-state-title { font-size: 32rpx; font-weight: 700; line-height: 1.5; color: #35291e; }
.search-state-hint { margin-top: 12rpx; font-size: 26rpx; color: #998a75; line-height: 1.5; }
.search-history-tags { display: flex; flex-wrap: wrap; gap: 16rpx; padding: 26rpx 28rpx 32rpx; }
.search-history-tag { max-width: 100%; padding: 12rpx 24rpx; margin: 0; border-radius: 40rpx; background: #fff0bb; color: #6d5733; font-size: 26rpx; line-height: 1.5; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.search-pressed { background: #ffe9a2; }
.search-status { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24rpx; min-height: 260rpx; padding: 32rpx; box-sizing: border-box; border-radius: 30rpx; background: #fffefa; color: #998a75; font-size: 26rpx; text-align: center; }
.search-loading-dot { width: 22rpx; height: 22rpx; border-radius: 50%; background: #edb328; animation: search-pulse 1s ease-in-out infinite alternate; }
@keyframes search-pulse { from { opacity: .35; } to { opacity: 1; } }
.search-retry { margin: 0; background: #fff0bb; color: #916c22; }
.search-results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16rpx; }
.search-dish-card { width: 100%; min-width: 0; margin: 0; padding: 8rpx 8rpx 0; box-sizing: border-box; border-radius: 22rpx; background: #fffefa; color: #35291e; box-shadow: 0 5rpx 16rpx rgba(155,112,30,.07); }
.search-dish-ratio { position: relative; width: 100%; padding-top: 100%; }
.search-dish-image { position: absolute; inset: 0; border-radius: 14rpx; overflow: hidden; }
.search-dish-caption { display: flex; align-items: center; justify-content: center; min-height: 68rpx; padding: 10rpx 4rpx; box-sizing: border-box; }
.search-dish-caption text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 28rpx; font-weight: 500; line-height: 1.4; word-break: break-all; }
.search-footer { padding: 26rpx 0 8rpx; text-align: center; color: #aaa394; font-size: 24rpx; }
@media screen and (max-height: 550px) { .search-empty { padding-top: 28rpx; padding-bottom: 32rpx; } .search-empty-image { width: 290rpx; height: 260rpx; } }
</style>
