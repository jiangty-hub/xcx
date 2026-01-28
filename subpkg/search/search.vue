<template>
  <view>
    <view class="search-box">
      <uni-search-bar v-model="kw" @input="onInput" :radius="100" cancelButton="none" />
    </view>

    <!-- 搜索结果 -->
    <view class="sugg-list" v-if="searchResults.length">
      <view class="sugg-item" v-for="(item, i) in searchResults" :key="item._id || i" @click="gotoDetail(item)">
        <!-- 改：优先用 cover_urls[0] 展示（后端 searchFoods 已补 cover_urls） -->
        <image :src="getCover(item)" class="item-image" mode="aspectFill" />
        <text class="item-text">{{ item.name }}</text>
      </view>
    </view>

    <!-- 搜索历史 -->
    <view class="history-box" v-else>
      <view class="history-title">
        <text>搜索历史</text>
        <uni-icons type="trash" size="19" @click="clean" />
      </view>
      <view class="history-list">
        <uni-tag
          type="default"
          :text="item"
          v-for="(item, i) in histories"
          :key="i"
          @click="gotoHistory(item)"
        />
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      timer: null,
      kw: '',
      searchResults: [],
      historyList: [],
      loading: false,
      foodService: null
    }
  },

  onShow() {
    this.historyList = JSON.parse(uni.getStorageSync('kw') || '[]')
  },

  created() {
    // 云对象实例
    this.foodService = uniCloud.importObject('food-service')
  },

  methods: {
    onInput(val) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.kw = val
        this.search()
      }, 400)
    },

    async search() {
      const keyword = (this.kw || '').trim()
      if (!keyword) {
        this.searchResults = []
        return
      }

      if (this.loading) return
      this.loading = true

      try {
        // 后端已返回：cover_images(fileID数组) + cover_urls(临时链接数组)
        const list = await this.foodService.searchFoods(keyword)
        this.searchResults = Array.isArray(list) ? list : []
        this.saveHistory(keyword)
      } catch (e) {
        console.error(e)
        this.searchResults = []
        uni.showToast({ title: '搜索失败', icon: 'none' })
      } finally {
        this.loading = false
      }
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
      this.historyList = Array.from(set)
      uni.setStorageSync('kw', JSON.stringify(this.historyList))
    },

    clean() {
      this.historyList = []
      uni.setStorageSync('kw', '[]')
    },

    gotoHistory(item) {
      this.kw = item
      this.search()
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

  .uni-tag {
    margin-top: 5px;
    margin-right: 5px;
  }
}
</style>
