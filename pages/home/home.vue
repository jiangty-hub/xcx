<template>
	<view>
		<!--搜索组件-->
		<view class="search-box">
			<my-search @click="gotoSearch"></my-search>
		</view>
		<!--轮播图区域-->
		<swiper :indicator-dots="true" :autoplay="true" :interval="3000" :duration="1000" :circular="true">
			<swiper-item class="swiper-item" v-for="(item, i) in swiperList" :key="i">
				<image :src="item.image_src"></image>
			</swiper-item>
		</swiper>
		<!--分类导航区域-->
		<view class="nav-list">
			<view class="nav-item" v-for="(item, i) in navList" :key="i" @click="nacClickHandler(item)">
				<view class="nav-icon-box">
					<image class="nav-icon" :src="item.icon"></image>
				</view>
				<text class="nav-text">{{ item.name }}</text>
			</view>
		</view>
		<!--拿手好菜区域-->
		<view class="floor-list">
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
	export default {
		data() {
			return {
				//轮播图数组
				swiperList: [],
				//分类导航数组
				navList: [],
				//拿手菜系数组
				floorList: []
			}
		},
		onLoad() {
			this.getBanner()
			this.getIcon()
			this.getFloor()
		},
		methods: {
		  getBanner() {
		    uniCloud.callFunction({
		      name: 'getBanner',
		      success: (res) => {
				this.swiperList = res.result.data
		      },
		      fail: (err) => {
		        this.$showError(err, '轮播图加载失败', 1500)
		      }
		    })
		  },
		  getIcon() {
		    uniCloud.callFunction({
		      name: 'getIcon',
		      success: (res) => {
		  		this.navList = res.result.data
		      },
		      fail: (err) => {
		        this.$showError(err, '图标加载失败', 1500)
		      }
		    })
		  },
		  getFloor() {
		    uniCloud.callFunction({
		      name: 'getFloor',
		      success: (res) => {
		  		this.floorList = Array.isArray(res.result?.data) ? res.result.data : []
		      },
		      fail: (err) => {
		        this.$showError(err, '图片加载失败', 1500)
		      }
		    })
		  },
		  getFloorImage(group, index) {
		  	const defaultImg = '/static/cover-default.png'
		  	if (!Array.isArray(group)) return defaultImg
		  	const item = group[index]
		  	if (!item || !item.image_src) return defaultImg
		  	return item.image_src
		  },
		  nacClickHandler(item) {
		  	//把参数存储到本地
		  	wx.setStorageSync('selectedCategory', item.name)
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
</style>
