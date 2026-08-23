<template>
  <view>
    <view class="search-box">
      <uni-search-bar v-model="kw" @input="onInput" :radius="100" cancelButton="none" />
    </view>

    <view v-if="loading" class="search-state">搜索中...</view>
    <view v-else-if="searchError" class="search-state error-state">
      <text>{{ searchError }}</text>
      <button size="mini" @click="retrySearch">重试</button>
    </view>

    <!-- 搜索结果 -->
    <view v-else-if="searchResults.length">
      <view class="sugg-list">
        <view class="sugg-item" v-for="(item, i) in searchResults" :key="item._id || item.foodId || i" @click="gotoDetail(item)">
          <!-- 改：优先用 cover_urls[0] 展示（后端 searchFoods 已补 cover_urls） -->
          <image :src="getCover(item)" class="item-image" mode="aspectFill" />
          <text class="item-text">{{ item.name }}</text>
        </view>
      </view>
      <view v-if="loadingMore" class="load-more-state">加载更多...</view>
      <view v-else-if="!searchHasMore" class="load-more-state">已经到底了</view>
    </view>

    <view v-else-if="hasSearched && kw.trim()" class="search-state">没有找到相关菜品</view>

    <!-- 搜索历史 -->
    <view class="history-box" v-else>
      <view class="history-title">
        <text>搜索历史</text>
        <uni-icons type="trash" size="19" @click="clean" />
      </view>
      <view class="history-list" v-if="histories.length">
        <uni-tag
          type="default"
          :text="item"
          v-for="(item, i) in histories"
          :key="i"
          @click="gotoHistory(item)"
        />
      </view>
      <view v-else class="history-empty">暂无搜索历史</view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      timer: null,
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
      foodService: null
    }
  },

  onShow() {
    try {
      const stored = uni.getStorageSync('kw')
      const parsed = typeof stored === 'string' ? JSON.parse(stored || '[]') : stored
      this.historyList = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(-20) : []
    } catch (e) {
      this.historyList = []
      uni.removeStorageSync('kw')
    }
  },

  onUnload() {
    clearTimeout(this.timer)
    this.searchSeq += 1
  },

  onReachBottom() {
    this.loadMoreResults()
  },

  created() {
    // 云对象实例
    this.foodService = uniCloud.importObject('food-service')
  },

  methods: {
    onInput(val) {
      clearTimeout(this.timer)
      const seq = ++this.searchSeq
      if (!String(val || '').trim()) {
        this.kw = ''
        this.searchResults = []
        this.hasSearched = false
        this.searchError = ''
        this.loading = false
        this.loadingMore = false
        this.searchPage = 1
        this.searchHasMore = false
        return
      }
      // 新关键词进入防抖等待后，立即禁用旧结果的续页，避免不同关键词串页。
      this.searchPage = 1
      this.searchHasMore = false
      this.loadingMore = false
      this.timer = setTimeout(() => {
        this.kw = val
        this.search(seq)
      }, 400)
    },

    async search(seq = ++this.searchSeq, { append = false } = {}) {
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

      if (append) {
        if (this.loading || this.loadingMore || !this.searchHasMore) return
        this.loadingMore = true
      } else {
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
      uni.navigateTo({
        url: '/subpkg/goods_detail/goods_detail?id=' + id
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
      clearTimeout(this.timer)
      this.kw = item
      this.search(++this.searchSeq)
    },

    retrySearch() {
      this.search(++this.searchSeq)
    }
  },

  computed: {
    histories() {
      return [...this.historyList].reverse()
    }
  }
}
</script>

<style lang="scss">
.search-box {
  position: sticky;
  top: 0;
  z-index: 999;
}

.search-state {
  min-height: 360rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  color: #999;
}

.error-state {
  color: #666;
}

.item-image {
  width: 90%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 12px;
  display: block;
}

.item-text {
  margin-top: 6px;
  text-align: center;
  font-size: 28rpx;
  line-height: 1.3;
}

.sugg-list {
  display: flex;
  flex-wrap: wrap;
}

.load-more-state {
  padding: 20rpx 0 32rpx;
  text-align: center;
  color: #999;
  font-size: 24rpx;
}

.sugg-item {
  width: 50%;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  // 立体卡片效果
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 3px 6px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.06);
  margin-bottom: 16px;
}

.history-box {
  padding: 0 5px;

  .history-title {
    display: flex;
    justify-content: space-between;
    height: 40px;
    align-items: center;
    font-size: 13px;
    border-bottom: 1px solid #efefef;
  }

  .history-list {
    display: flex;
    flex-wrap: wrap;
  }

  .history-empty {
    padding: 80rpx 0;
    text-align: center;
    color: #999;
    font-size: 26rpx;
  }

  .uni-tag {
    margin-top: 5px;
    margin-right: 5px;
  }
}
</style>
