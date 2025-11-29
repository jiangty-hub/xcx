<template>
	<view class="my-search-container" :style="{'backgroundColor': bgcolor}" @click="searchBoxHandler">
		<view class="my-search-box" :style="{'borderRadius': radius + 'px'}">
			<!--uni-ui的图标组件-->
			<uni-icons type="search" size="17"></uni-icons>
			<text class="placeholder">搜索</text>
		</view>
	</view>
</template>
<script>
	export default {
		props: {
			//背景颜色
			bgcolor: {
				type: String,
				default: '#f8f8f8'
			},
			//圆角尺寸
			radius: {
				type: Number,
				default: 18 //px
			}
		},
		data() {
			return {
				
			};
		},
		methods: {
			searchBoxHandler() {
				this.$emit('click')
			}
		}
	}
</script>

<style lang="scss">
.my-search-container {
  //background-color: #f8f8f8;
  height: 50px;
  padding: 0 10px;
  display: flex;
  align-items: center;
}

.my-search-box {
  height: 36px;
  background-color: #ffffff;
  //border-radius: 15px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  .placeholder {
    font-size: 15px;
    margin-left: 5px;
  }
}
</style>
