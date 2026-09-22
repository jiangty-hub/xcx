<template>
	<view>
		<!--搜索组件-->
		<view class="search-box">
			<my-search @click="gotoSearch"></my-search>
		</view>
		<view v-if="homeEmpty" class="home-state">暂无首页内容</view>
		<!--轮播图区域-->
		<view
			v-if="!swiperList.length && (!sections.banner.loaded || sections.banner.loading || sections.banner.error)"
			class="section-state banner-state"
		>
			<text>{{ sections.banner.error || '轮播图加载中...' }}</text>
			<button v-if="sections.banner.error" size="mini" @click="loadSection('banner')">重试</button>
		</view>
		<view v-else-if="swiperList.length && sections.banner.error" class="partial-error">
			<text>{{ sections.banner.error }}，当前显示已有内容</text>
			<button size="mini" @click="loadSection('banner')">重试</button>
		</view>
		<swiper v-if="swiperList.length" :indicator-dots="true" :autoplay="true" :interval="3000" :duration="1000" :circular="true">
			<swiper-item class="swiper-item" v-for="(item, i) in swiperList" :key="i">
				<image :src="item.image_src"></image>
			</swiper-item>
		</swiper>
		<!--分类导航区域-->
		<view
			v-if="!navList.length && (!sections.icon.loaded || sections.icon.loading || sections.icon.error)"
			class="section-state icon-state"
		>
			<text>{{ sections.icon.error || '分类导航加载中...' }}</text>
			<button v-if="sections.icon.error" size="mini" @click="loadSection('icon')">重试</button>
		</view>
		<view v-else-if="navList.length && sections.icon.error" class="partial-error">
			<text>{{ sections.icon.error }}，当前显示已有内容</text>
			<button size="mini" @click="loadSection('icon')">重试</button>
		</view>
		<view class="nav-list" v-if="navList.length">
			<view class="nav-item" v-for="(item, i) in navList" :key="i" @click="nacClickHandler(item)">
				<view class="nav-icon-box">
					<image class="nav-icon" :src="item.icon"></image>
				</view>
				<text class="nav-text">{{ item.name }}</text>
			</view>
		</view>
		<!--拿手好菜区域-->
		<view
			v-if="!floorList.length && (!sections.floor.loaded || sections.floor.loading || sections.floor.error)"
			class="section-state floor-state"
		>
			<text>{{ sections.floor.error || '拿手好菜加载中...' }}</text>
			<button v-if="sections.floor.error" size="mini" @click="loadSection('floor')">重试</button>
		</view>
		<view v-else-if="floorList.length && sections.floor.error" class="partial-error">
			<text>{{ sections.floor.error }}，当前显示已有内容</text>
			<button size="mini" @click="loadSection('floor')">重试</button>
		</view>
		<view class="floor-list" v-if="floorList.length">
			<!--拿手好菜名字-->
			<text class="floor-text">◆拿手好菜</text>
			<!--拿手好菜数组-->
			<view class="floor-item" v-for="(item, i) in floorList" :key="i">
				<view class="floor-img-box">
					<!--左侧大图片盒子-->
					<view class="left-img-box">
						<image :src="getFloorImage(item, 0)" class="floor-img-big" mode="aspectFill"></image>
					</view>
					<!--右侧小图片盒子-->
					<view class="right-img-box">
						<image :src="getFloorImage(item, 1)" class="floor-img-small" mode="aspectFill"></image>
						<image :src="getFloorImage(item, 2)" class="floor-img-small" mode="aspectFill"></image>
						<image :src="getFloorImage(item, 3)" class="floor-img-small" mode="aspectFill"></image>
						<image :src="getFloorImage(item, 4)" class="floor-img-small" mode="aspectFill"></image>
					</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { getResumeRefreshState } from '@/utils/resume-refresh.js'

	const HOME_SECTIONS = {
		banner: { target: 'swiperList', method: 'getBanner', label: '轮播图' },
		icon: { target: 'navList', method: 'getIcon', label: '分类导航' },
		floor: { target: 'floorList', method: 'getFloor', label: '拿手好菜' }
	}

	export default {
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
			homeEmpty() {
				return Object.keys(HOME_SECTIONS).every(key => {
					const state = this.sections[key]
					return state.loaded && !state.loading && !state.error &&
						!this[HOME_SECTIONS[key].target].length
				})
			}
		},
		onLoad() {
			this.lastResumeSeqHandled = getResumeRefreshState(0).seq
			this.loadHome()
		},
		async onShow() {
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
		  getFloorImage(group, index) {
		  	const defaultImg = '/static/cover-default.png'
		  	if (!Array.isArray(group)) return defaultImg
		  	const item = group[index]
		  	if (!item || !item.image_src) return defaultImg
		  	return item.image_src
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

<style lang="scss">
swiper {
	height: 330rpx;
	
	.swiper-item,
	image {
		width: 100%;
		height: 100%;
	}
}
.nav-list {
	display: flex;
	flex-wrap: wrap; /* 允许换行 */
	padding: 0 20rpx;
	
	.nav-item {
		width: 25%; 
	    display: flex;
	    flex-direction: column; /* 图标在上，文字在下 */
	    align-items: center;
	    padding: 20rpx 0;
	}
	.nav-icon-box {
		width: 130rpx;
		height: 130rpx;
		background-color: #f6f6f6;
		border-radius: 26rpx;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.nav-icon {
		width: 120rpx;           /* 固定宽度 */
		height: 120rpx;          /* 固定高度 */
		object-fit: contain;     /* 保持比例 */
	}
	.nav-text {
	    font-size: 28rpx;
		margin-top: 10rpx;
	    text-align: center;
	}
}
.floor-text {
	font-size: 30rpx;
	font-weight: bold;
	font-family: Arial;
	letter-spacing: 5rpx;
	text-shadow: 1px 1px 2px #999;
	color: #e64340;
}
.right-img-box {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-around;
	padding-left: 5rpx;
}
.floor-img-box {
	display: flex;
	padding-left: 5rpx;
}
.search-box {
	position: sticky;
	top: 0;
	z-index: 999;
}
.floor-img-big {
	width: 303rpx;
	height: 405rpx;   /* 你可以根据设计微调 */
	border-radius: 16rpx;
	object-fit: cover;
}
.floor-img-small {
	width: 220rpx;
	height: 200rpx;
	border-radius: 16rpx;
	object-fit: cover;
}
.home-state {
	min-height: 600rpx;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 24rpx;
	color: #999;
}
.section-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 20rpx;
	background: #f6f6f6;
	color: #999;
	font-size: 26rpx;
}
.banner-state { min-height: 330rpx; }
.icon-state { min-height: 220rpx; }
.floor-state { min-height: 445rpx; }
.partial-error {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16rpx 24rpx;
	background: #fff7e6;
	color: #ad6800;
	font-size: 26rpx;
}
</style>
