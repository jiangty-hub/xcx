<template>
	<view class="page">
		<!-- 可滚动内容区域 -->
		<scroll-view class="content" scroll-y>
			<view class="card">
				<view class="row">
					<image class="avatar" :src="avatar || '/static/avatar-default.png'" mode="aspectFill"/>
					<view class="info">
						<text class="name">{{ nickname || '用户' }}</text>
						<text class="desc">已登录</text>
					</view>
					<button class="mini" size="mini" @click="$emit('editProfile')" >修改资料</button>
				</view>
			</view>

			<view class="card">
				<button class="btn" type="primary" @click="$emit('goAddDish')">新增菜品</button>
			</view>

			<!-- 占位，防止内容被底部按钮挡住 -->
			<view class="bottom-space" />
		</scroll-view>

		<!-- 固定在底部的退出登录 -->
		<view class="logout-fixed">
			<button class="btn-danger" @click="$emit('logout')">退出登录</button>
		</view>
	</view>
</template>


<script>
	export default {
		props: {
			nickname: { type: String, default: '' },
			avatar: { type: String, default: '' }
		}
	}
</script>

<style scoped>
.page {
	height: 100vh;
	display: flex;
	flex-direction: column;
	background: #f5f5f5;
}

/* 可滚动内容 */
.content {
	flex: 1;
}

/* 卡片样式 */
.card {
	margin: 24rpx;
	padding: 24rpx;
	background: #fff;
	border-radius: 16rpx;
}

/* 用户信息 */
.row {
	display: flex;
	align-items: center;
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

/* 按钮 */
.btn {
	border-radius: 12rpx;
}
.btn-danger{
  margin: 0;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 16rpx;
  background: #ff4d4f;
  color: #fff;
  font-size: 32rpx;
  border: none;
}
.btn-danger::after{
  border: none;
  border-radius: 16rpx;
}

/* mini 按钮 */
.mini {
	margin-left: 12rpx;
}

/* 底部固定区域 */
.logout-fixed{
  left: 24rpx;
  right: 24rpx;
  bottom: 10rpx;
  position: fixed;
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  box-shadow: 0 -4rpx 12rpx rgba(0,0,0,0.06);
}

/* 给 scroll-view 预留空间 */
.bottom-space {
	height: calc(88rpx + 48rpx + 100rpx + env(safe-area-inset-bottom));
}
</style>
