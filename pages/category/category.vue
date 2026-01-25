<template>
	<view>
		<!--使用自定义的搜索组件-->
		<my-search @click="gotoSearch"></my-search>
		<view class="scroll-view-container">
			<!--左侧分类区域-->
			<scroll-view class="left-srcoll-view" scroll-y="true" :style="{height: wh + 'px'}">
				<block v-for="(item, i) in cateList" :key="i">
					<view :class="['left-scroll-view-item', i === active ? 'active' : '']" @click="activeChanged(i)">{{ item.name }}</view>
				</block>
			</scroll-view>
			<!--右侧菜品区域-->
			<scroll-view scroll-y="true" :style="{height: wh + 'px'}" :scroll-top="scrollTop">
				<!-- 实际做 flex 的地方 -->
				<view class="right-scroll-view">
					<view class="right-scroll-view-item" v-for="(item, i2) in cateLevel" :key="i2" @click="gotoGoodsDetail(item)">
						<!--图片 cover_images[0]-->
						<image :src="getCover(item)" class="item-image" mode="aspectFill"></image>
						<!--文本-->
						<text class="item-text">{{item.name}}</text>
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
				//当前设备可用高度
				wh: 0,
				active: 0,
				//分类数据数组（左)
				cateList: [],
				//分类数据数组（右)
				cateLevel: [],
				scrollTop: 0
			};
		},
		async onLoad() {
			const sysInfo = uni.getWindowInfo()
			this.wh = sysInfo.windowHeight - 50
			await this.getCateList()
		},
		onShow() {
				// onShow 里也保留一份：防止你从其它页面回来时再次定位分类
				this.applySelectedCategoryFromStorage()
			},
		methods: {
			// 封面兜底：cover_images[0] 没有就给默认图
			getCover(food) {
				if (food && Array.isArray(food.cover_images) && food.cover_images.length > 0 && food.cover_images[0]) {
					return food.cover_images[0]
				}
			},
			// 从 storage 读取 home 传来的分类，并切换
			async applySelectedCategoryFromStorage() {
				const selectedCategory = wx.getStorageSync('selectedCategory')
				if (!selectedCategory) return
				if (!this.cateList || this.cateList.length === 0) return
				const index = this.cateList.findIndex(item =>
						item.name === selectedCategory ||
						item.name.replace(/类$/, '') === selectedCategory
					)
			
					if (index !== -1) {
						await this.activeChanged(index)
					}
					wx.removeStorageSync('selectedCategory')
			},	
			//获取分类列表数组
			async getCateList() {
				try {
					const categories = await foodService.getCategories()
					this.cateList = categories || []
					// 默认加载第一个分类的右侧菜品
					if (this.cateList.length > 0) {
						const firstCateId = this.cateList[0].cate_id
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
				try {
					const foods = await foodService.getFoodsByCategory(cateId)
					this.cateLevel = foods || []
				} catch (err) {
					this.$showError(err, '菜品加载失败', 1500)
				}
			},
			// 左侧切换
			async activeChanged(i) {
				this.active = i
				const cateId = this.cateList[i].cate_id
				await this.loadFoodsByCategory(cateId)
				// 让右侧滚动条回到顶部
				this.scrollTop = this.scrollTop === 0 ? 1 : 0
			},
			//跳转到菜品详细页面
			gotoGoodsDetail(food) {
				uni.navigateTo({
					url: '/subpkg/goods_detail/goods_detail?id=' + food._id
				})
			},
			//跳转到search页面
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
	width: 200rpx; /* 改用 rpx */
	flex-shrink: 0; /* 防止被压缩 */
	
	.left-scroll-view-item {
		background-color: #f7f7f7;
		line-height: 100rpx;
		text-align: center;
		font-size: 28rpx;
		
		&.active {
			background-color: #FFFFFF;
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