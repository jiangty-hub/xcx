<template>
  <view class="home-page">
    <image class="home-hero" src="/static/home/brand-hero.png" mode="widthFix" aria-label="大姜菜品，今天想吃什么呀？" />
    <view class="home-content">
      <button class="home-search" hover-class="home-search-pressed" @click="gotoSearch">
        <view class="search-symbol" aria-hidden="true"></view>
        <text>搜搜想吃的菜</text>
      </button>
      <view v-if="homeEmpty" class="home-state">暂无首页内容</view>

      <view v-if="!swiperList.length && (!sections.banner.loaded || sections.banner.loading || sections.banner.error)" class="section-state banner-state">
        <text>{{ sections.banner.error || '轮播图加载中…' }}</text>
        <button v-if="sections.banner.error" size="mini" @click="loadSection('banner')">重试</button>
      </view>
      <view v-else-if="swiperList.length && sections.banner.error" class="partial-error">
        <text>{{ sections.banner.error }}，当前显示已有内容</text>
        <button size="mini" @click="loadSection('banner')">重试</button>
      </view>
      <swiper v-if="swiperList.length" class="home-banner" indicator-dots indicator-color="rgba(255,255,255,0.9)" indicator-active-color="#E3A500" autoplay :interval="3000" :duration="1000" circular>
        <swiper-item v-for="(item, i) in swiperList" :key="item._id || i">
          <home-picture :src="item.image_src" />
        </swiper-item>
      </swiper>

      <view v-if="!navList.length && (!sections.icon.loaded || sections.icon.loading || sections.icon.error)" class="section-state icon-state">
        <text>{{ sections.icon.error || '分类导航加载中…' }}</text>
        <button v-if="sections.icon.error" size="mini" @click="loadSection('icon')">重试</button>
      </view>
      <view v-else-if="navList.length && sections.icon.error" class="partial-error">
        <text>{{ sections.icon.error }}，当前显示已有内容</text>
        <button size="mini" @click="loadSection('icon')">重试</button>
      </view>
      <view v-if="navList.length" class="home-categories">
        <button class="category-card" v-for="(item, i) in navList" :key="item._id || i" hover-class="category-pressed" @click="nacClickHandler(item)">
          <view class="category-image"><home-picture :src="item.icon" mode="aspectFit" /></view>
          <text class="category-label">{{ item.name }}</text>
        </button>
      </view>

      <view v-if="!homeEmpty" class="featured-heading">
        <view class="paw" aria-hidden="true"><view class="toe toe-one"></view><view class="toe toe-two"></view><view class="toe toe-three"></view><view class="toe toe-four"></view><view class="paw-pad"></view></view>
        <text class="featured-title">拿手好菜</text>
        <text class="featured-subtitle">家里的招牌味道</text>
      </view>
      <view v-if="!featuredDishes.length && (!sections.floor.loaded || sections.floor.loading || sections.floor.error)" class="section-state floor-state">
        <text>{{ sections.floor.error || '拿手好菜加载中…' }}</text>
        <button v-if="sections.floor.error" size="mini" @click="loadSection('floor')">重试</button>
      </view>
      <view v-else-if="featuredDishes.length && sections.floor.error" class="partial-error">
        <text>{{ sections.floor.error }}，当前显示已有内容</text>
        <button size="mini" @click="loadSection('floor')">重试</button>
      </view>
      <view v-else-if="!featuredDishes.length && !homeEmpty" class="section-state">暂无拿手好菜</view>
      <view v-if="featuredDishes.length" class="featured-grid">
        <view class="dish-card" v-for="dish in featuredDishes" :key="dish.id">
          <view class="dish-image"><home-picture :src="dish.image" /></view>
          <view class="dish-caption"><view class="dish-dot"></view><text class="dish-name">{{ dish.name }}</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { syncTabBar } from '@/utils/tab-bar.js'
	import HomePicture from '@/components/home/home-picture.vue'
	import { getFeaturedDishes } from '@/utils/home-display.js'
	import { getResumeRefreshState } from '@/utils/resume-refresh.js'

	const HOME_SECTIONS = {
		banner: { target: 'swiperList', method: 'getBanner', label: '轮播图' },
		icon: { target: 'navList', method: 'getIcon', label: '分类导航' },
		floor: { target: 'floorList', method: 'getFloor', label: '拿手好菜' }
	}

	export default {
		components: { HomePicture },
		data() {
			return {
				//轮播图数组
				swiperList: [],
				//分类导航数组
				navList: [],
				//拿手菜系数组
				floorList: [],
				sections: {
					banner: { loading: false, loaded: false, error: '' },
					icon: { loading: false, loaded: false, error: '' },
					floor: { loading: false, loaded: false, error: '' }
				},
				lastResumeSeqHandled: 0
			}
		},
		computed: {
			featuredDishes() { return getFeaturedDishes(this.floorList) },
			homeEmpty() {
				return Object.keys(HOME_SECTIONS).every(key => {
					const state = this.sections[key]
					return state.loaded && !state.loading && !state.error &&
						!(key === 'floor' ? this.featuredDishes : this[HOME_SECTIONS[key].target]).length
				})
			}
		},
		onLoad() {
			this.lastResumeSeqHandled = getResumeRefreshState(0).seq
			this.loadHome()
		},
		onReady() {
    syncTabBar(this, 0)
  },
		async onShow() {
    syncTabBar(this, 0)
			const resume = getResumeRefreshState(this.lastResumeSeqHandled)
			if (resume.seq) this.lastResumeSeqHandled = resume.seq
			if (resume.shouldRefresh) await this.loadHome()
		},
		methods: {
		  async loadHome() {
			// 各区域在自己的请求结束时立即更新，汇总等待不控制页面展示。
			await Promise.all(Object.keys(HOME_SECTIONS).map(key => this.loadSection(key)))
		  },
		  async loadSection(key) {
			const config = HOME_SECTIONS[key]
			if (!config) return
			const state = this.sections[key]
			// 避免重试连点或后台恢复重复请求同一区域。
			if (state.loading) return
			state.loading = true
			state.error = ''
			try {
				this[config.target] = await this[config.method]()
				state.loaded = true
			} catch (error) {
				// 刷新失败保留已有内容，首次失败只影响当前区域。
				state.error = config.label + '加载失败'
				console.error(config.label + ' load failed:', error)
			} finally {
				state.loading = false
			}
		  },
		  async getBanner() {
		    const res = await uniCloud.callFunction({ name: 'getBanner' })
			if (res.result?.code !== 0) throw new Error(res.result?.msg || '轮播图加载失败')
			return Array.isArray(res.result?.data) ? res.result.data : []
		  },
		  async getIcon() {
		    const res = await uniCloud.callFunction({ name: 'getIcon' })
			if (res.result?.code !== 0) throw new Error(res.result?.msg || '图标加载失败')
			return Array.isArray(res.result?.data) ? res.result.data : []
		  },
		  async getFloor() {
		    const res = await uniCloud.callFunction({ name: 'getFloor' })
			if (res.result?.code !== 0) throw new Error(res.result?.msg || '图片加载失败')
			const groups = Array.isArray(res.result?.data) ? res.result.data : []
			return groups.filter(group => Array.isArray(group) && group.length)
		  },
          nacClickHandler(item) {
            // 使用稳定的分类 ID 跳转，避免分类改名后无法匹配。
            const cateId = item?.cate_id
            if (cateId === undefined || cateId === null || cateId === '') {
              uni.showToast({ title: '该分类缺少ID', icon: 'none' })
              return
            }
            uni.setStorageSync('selectedCategoryId', cateId)
            // 清掉旧版本可能遗留的名称缓存。
            uni.removeStorageSync('selectedCategory')
            //跳转 tabBar 页面
            uni.switchTab({
              url: '/pages/category/category'
            });
          },
		  gotoSearch() {
			  uni.navigateTo({
				url: '/subpkg/search/search'
			  })
		  }
		}
	}
</script>

<style lang="scss" scoped>
.home-page {
  min-height: 100vh; box-sizing: border-box; padding-bottom: 28rpx;
  background: #fffbeb; color: #35291e;
  /* #ifdef MP-WEIXIN */
  padding-bottom: calc(152rpx + env(safe-area-inset-bottom));
  /* #endif */
}
.home-hero { display: block; width: 100%; }
.home-content { padding: 0 28rpx; }
.home-search {
  display: flex; align-items: center; width: 100%; height: 70rpx; margin: 8rpx 0 16rpx;
  padding: 0 32rpx; border-radius: 40rpx; background: #fff0bb; color: #998a75;
  font-size: 28rpx; line-height: 1.4; text-align: left; font-weight: 500;
}
.home-search::after, .category-card::after { border: none; }
.home-search-pressed { background: #ffe9a2; }
.search-symbol { width: 26rpx; height: 26rpx; border: 4rpx solid #b88200; border-radius: 50%; margin-right: 28rpx; position: relative; flex-shrink: 0; }
.search-symbol::after { content: ''; position: absolute; width: 15rpx; height: 4rpx; background: #b88200; border-radius: 4rpx; right: -11rpx; bottom: -5rpx; transform: rotate(48deg); }
.home-banner { height: 243rpx; border-radius: 30rpx; overflow: hidden; transform: translateZ(0); }
.home-categories { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14rpx 18rpx; margin-top: 16rpx; }
.category-card { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-width: 0; min-height: 146rpx; margin: 0; padding: 12rpx 4rpx; border-radius: 28rpx; background: #fffefa; box-shadow: 0 5rpx 18rpx rgba(155, 112, 30, .07); line-height: 1.3; color: #211c17; }
.category-pressed { background: #fff0bb; }
.category-image { width: 88rpx; height: 88rpx; }
.category-label { margin-top: 6rpx; font-size: 27rpx; font-weight: 500; word-break: break-all; }
.featured-heading { display: flex; align-items: center; flex-wrap: wrap; margin: 24rpx 0 14rpx; }
.featured-title { font-size: 40rpx; line-height: 1.3; font-weight: 800; letter-spacing: 2rpx; }
.featured-subtitle { margin-left: 22rpx; padding-left: 20rpx; border-left: 2rpx solid #a38d66; font-size: 22rpx; color: #998a75; line-height: 1.2; }
.paw { position: relative; width: 47rpx; height: 47rpx; margin-right: 12rpx; flex-shrink: 0; }
.toe, .paw-pad { position: absolute; background: #f6bf36; }
.toe { width: 12rpx; height: 17rpx; border-radius: 50%; }
.toe-one { left: 1rpx; top: 14rpx; transform: rotate(-28deg); }
.toe-two { left: 12rpx; top: 1rpx; transform: rotate(-12deg); }
.toe-three { right: 10rpx; top: 1rpx; transform: rotate(12deg); }
.toe-four { right: 0; top: 14rpx; transform: rotate(28deg); }
.paw-pad { width: 28rpx; height: 25rpx; left: 10rpx; bottom: 0; border-radius: 55% 55% 40% 40%; }
.featured-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14rpx 16rpx; }
.dish-card { min-width: 0; padding: 8rpx 8rpx 0; border-radius: 22rpx; background: #fffefa; box-shadow: 0 5rpx 20rpx rgba(155,112,30,.08); overflow: hidden; }
.dish-image { height: 156rpx; border-radius: 16rpx; overflow: hidden; }
.dish-caption { display: flex; align-items: center; min-height: 44rpx; padding: 4rpx 12rpx 7rpx; }
.dish-dot { width: 10rpx; height: 10rpx; background: #e3a500; border-radius: 50%; margin-right: 10rpx; flex-shrink: 0; }
.dish-name { font-size: 28rpx; line-height: 1.45; word-break: break-all; }
.home-state, .section-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20rpx; min-height: 140rpx; padding: 20rpx; box-sizing: border-box; border-radius: 24rpx; background: #fff7d9; color: #998a75; font-size: 26rpx; }
.banner-state { min-height: 243rpx; }
.icon-state { min-height: 306rpx; margin-top: 16rpx; }
.floor-state { min-height: 210rpx; }
.partial-error { display: flex; align-items: center; gap: 12rpx; padding: 16rpx; color: #916c22; background: #fff0bb; border-radius: 18rpx; margin: 12rpx 0; font-size: 24rpx; }
.partial-error text { flex: 1; }
.section-state button, .partial-error button { flex-shrink: 0; margin: 0; background: #fffefa; color: #916c22; }
@media screen and (max-width: 350px) { .featured-subtitle { font-size: 20rpx; margin-left: 14rpx; padding-left: 14rpx; } }
</style>
