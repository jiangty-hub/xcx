<template>
	<view>
		<view class="scroll-view-container">
			<!--左侧滑动区域-->
			<scroll-view class="left-srcoll-view" scroll-y="true" :style="{height: wh + 'px'}">
				<block v-for="(item, i) in cateList" :key="i">
					<view :class="['left-scroll-view-item', i === active ? 'active' : '']" @click="activeChanged(i)">{{item.cate_name}}</view>
				</block>
			</scroll-view>
			<!--右侧滑动区域-->
			<scroll-view scroll-y="true" :style="{height: wh + 'px'}" :scroll-top="scrollTop">
				<!-- 实际做 flex 的地方 -->
				<view class="right-scroll-view">
					<view class="right-scroll-view-item" v-for="(item, i2) in cateLevel" :key="i2" @click="gotoGoodsDetail(item)">
						<!--图片-->
						<image :src="item.cate_jpg" class="item-image"></image>
						<!--文本-->
						<text class="item-text">{{item.cate_name}}</text>
					</view>
				</view>
			</scroll-view>
		</view>
	</view>
</template>

<script>
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
		onLoad() {
			const sysInfo = uni.getSystemInfoSync()
			this.wh = sysInfo.windowHeight
			//调用获取分类列表数组
			this.getCateList()
		},
		methods: {
			//获取分类列表数组
			getCateList() {
				uni.request({
				  url: 'https://raw.githubusercontent.com/jiangty-hub/uniFenLei/main/FenLei.json',
				  method: 'GET',
				  success: (res) => {
					this.cateList = res.data.message
					this.cateLevel = res.data.message[0].children
				  },
				  fail: (err) => {
				    this.$showError(err, '图片加载失败', 1500)
				  }
				})
			},
			activeChanged(i) {
				this.active = i
				//给cateLevel赋值
				this.cateLevel = this.cateList[i].children
				//重新让滚动条归0/1
				this.scrollTop = this.scrollTop === 0 ? 1 : 0
			},
			//跳转到菜品详细页面
			gotoGoodsDetail(item) {
				uni.navigateTo({
					url:'/subpkg/goods_detail/goods_detail?cid=' + item.cate_id
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
	width: 180px;
	
	.left-scroll-view-item {
		background-color: #f7f7f7;
		line-height: 60px;
		text-align: center;
		font-size: 15px;
		
		&.active {
			background-color: #FFFFFF;
			position: relative;
			
			&::before {
				content: ' ';
				display: block;
				width: 3px;
				height: 30px;
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
}
.right-scroll-view-item {
	width: 50%;
	padding: 10px;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	align-items: center;
}
.item-image {
  width: 150px;
  height: 150px;	
  object-fit: cover;
  border-radius: 8px;
  display: block;
}
.item-text {
  margin-top: 6px;
  text-align: center;
  font-size: 28rpx;
  line-height: 1.3;
}
</style>