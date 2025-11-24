<template>
	<view>
		<!--轮播图区域-->
		<swiper :indicator-dots="true" :autoplay="true" :interval="3000" :duration="1000" :circular="true">
			<swiper-item v-for="(item, i) in swiperList" :key="i">
				<navigator class="swiper-item" :url="'/subpkg/goods_detail/goods_detail?goods_id=' + item.goods_id">
					<image :src="item.image_src"></image>
				</navigator>
			</swiper-item>
		</swiper>
		<!--分类导航区域-->
		<view class="nav-list">
			<view class="nav-item" v-for="(item, i) in navList" :key="i" @click="nacClickHandler(item)">
				<image :src="item.icon" class="nav-icon"></image>
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
						<image :src="item[0].image_src" :style="{ width: '303rpx', borderRadius: '16rpx' }" mode="widthFix"></image>
					</view>
					<!--右侧小图片盒子-->
					<view class="right-img-box">
						<image :src="item[1].image_src" :style="{ width: '220rpx', borderRadius: '16rpx' }" mode="widthFix">></image>
						<image :src="item[2].image_src" :style="{ width: '220rpx', borderRadius: '16rpx' }" mode="widthFix">></image>
						<image :src="item[3].image_src" :style="{ width: '220rpx', borderRadius: '16rpx' }" mode="widthFix">></image>
						<image :src="item[4].image_src" :style="{ width: '220rpx', borderRadius: '16rpx' }" mode="widthFix">></image>
					</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
import { showRequestError } from '@/main.js'

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
			this.getSwiperList()
			this.getNavList()
			this.getFloorList()
		},
		methods: {
		  getSwiperList() {
		    uni.request({
		      url: 'https://raw.githubusercontent.com/jiangty-hub/uniPicture/main/picture.json',
		      method: 'GET',
		      success: (res) => {
				this.swiperList = res.data
		      },
		      fail: (err) => {
		        this.$showError(err, '轮播图加载失败', 1500)
		      }
		    })
		  },
		  getNavList() {
		    uni.request({
		      url: 'https://raw.githubusercontent.com/jiangty-hub/uniIcon/main/icon.json',
		      method: 'GET',
		      success: (res) => {
		  				this.navList = res.data
		      },
		      fail: (err) => {
		        this.$showError(err, '图标加载失败', 1500)
		      }
		    })
		  },
		  nacClickHandler(item) {
			uni.switchTab({
				url: `/pages/category/category?category=${encodeURIComponent(item.name)}`
			})
		  },
		  getFloorList() {
		    uni.request({
		      url: 'https://raw.githubusercontent.com/jiangty-hub/uniNashou/main/nashou.json',
		      method: 'GET',
		      success: (res) => {
		  				this.floorList = res.data
		      },
		      fail: (err) => {
		        this.$showError(err, '图片加载失败', 1500)
		      }
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
	justify-content: space-around; /* 每行左右间距均分 */
	margin: 20px 35px;
	
	.nav-item {
	    display: flex;
	    flex-direction: column; /* 图标在上，文字在下 */
	    align-items: center;
	    margin-bottom: 20rpx;
	}
	.nav-icon {
		width: 130rpx;           /* 固定宽度 */
		height: 130rpx;          /* 固定高度 */
		object-fit: contain;     /* 保持比例 */
	}
	.nav-text {
	    font-size: 28rpx;
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
</style>