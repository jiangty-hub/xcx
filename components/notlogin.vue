<template>
	<view class="card">
		<view class="row">
			<image class="avatar" src="/static/avatar-default.png" mode="aspectFill" />
			<view class="info">
				<text class="name">未登录</text>
				<text class="desc">登录后可使用更多功能</text>
			</view>
		</view>
		
		<button class="btn" type="primary" @click="$emit('login')">微信一键登录</button>
	</view>
</template>

<script>
	export default {}
</script>

<style scoped>
	.card {
	  margin: 24rpx;
	  padding: 24rpx;
	  background: #fff;
	  border-radius: 16rpx;
	}
	.row {
	  display: flex;
	  align-items: center;
	  margin-bottom: 20rpx;
	}
	.avatar {
	  width: 96rpx;
	  height: 96rpx;
	  border-radius: 48rpx;
	  background: #eee;
	}
	.info {
	  margin-left: 18rpx;
	  flex: 1;
	}
	.name {
	  font-size: 34rpx;
	  font-weight: 700;
	}
	.desc {
	  display: block;
	  margin-top: 6rpx;
	  font-size: 24rpx;
	  color: #888;
	}
	.btn {
	  border-radius: 12rpx;
	}
</style>
