<template>
	<view>
		<view class="search-box">
			<uni-search-bar @input="input" :radius="100" cancelButton="none" v-model="kw"></uni-search-bar>
		</view>
		<!--搜索列表-->
		<view class="sugg-list" v-if="searchResults.length !== 0">
			<view class="sugg-item" v-for="(item, i) in searchResults" :key="i" @click="gotoDetail(item)">
				<!--图片-->
				<image :src="item.cate_jpg" class="item-image"></image>
				<!--文本-->
				<text class="item-text">{{item.cate_name}}</text>
			</view>
		</view>
		<!--搜索历史-->
		<view class="history-box" v-else>
			<!--标题区域-->
			<view class="history-title">
				<text>搜索历史</text>
				<uni-icons type="trash" size="19" @click="clean"></uni-icons>
			</view>
			<!--列表区域-->
			<view class="history-list">
				<uni-tag type="default" :text="item" v-for="(item, i) in histories" :key="i" @click="gotoHistoryList(item)"></uni-tag>
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
				allChildren: [],
				historyList: []
			};
		},
		onShow() {
			this.historyList = JSON.parse(uni.getStorageSync('kw') || '[]')
		},
		created() {
			this.loadData()
		},
		methods: {
			//首次加载时只请求一次数据
			loadData() {
				uni.request({
					url:'https://raw.githubusercontent.com/jiangty-hub/uniFenLei/main/FenLei.json',
					method: 'GET',
					success: (res) => {
						//把所有 children 缓存起来
						this.allChildren = res.data.message.flatMap(item => item.children)
					},
					fail: (err) => {
						this.$showError(err, '数据加载失败', 1500)
					}
				})
			},
			//input输入事件的处理函数
			input(e) {
				//清除timer对应的延时器
				clearTimeout(this.timer)
				//500毫秒以内不触发输入事件
				this.timer = setTimeout(() => {
					this.kw = e
					this.getSearchList()
				}, 500)
			},
			getSearchList() {
				//搜索关键词是否为null
				if(this.kw.length === 0) {
					this.searchResults = []
					return
				}
				const kwLower = this.kw.toLowerCase()
				this.searchResults = this.allChildren.filter(item =>
						item.cate_name.toLowerCase().includes(kwLower)
					)
				this.saveSearchHistory()
				},
			gotoDetail(item) {
				uni.navigateTo({
					url:'/subpkg/goods_detail/goods_detail?cid=' + item.cate_id
				})
			},
			saveSearchHistory() {
				const set = new Set(this.historyList)
				set.delete(this.kw)
				set.add(this.kw)
				this.historyList = Array.from(set)
				//对搜索历史的数据进行持久化存储
				uni.setStorageSync('kw', JSON.stringify(this.historyList))
			},
			clean() {
				this.historyList = []
				uni.setStorageSync('kw', '[]')
			},
			gotoHistoryList(item) {
				this.kw = item
				this.getSearchList()
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
	//立体卡片效果
	background: #fff;
	border-radius: 16px;
	box-shadow: 0 3px 6px rgba(0,0,0,0.1), 
	            0 1px 3px rgba(0,0,0,0.06);
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