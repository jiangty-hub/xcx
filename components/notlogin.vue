<template>
  <view class="account-card">
    <view class="account-row">
      <image class="account-avatar" src="/static/avatar-default.png" mode="aspectFill" />
      <view class="account-info"><text class="account-name">未登录</text><text class="account-desc">登录后可使用更多功能</text></view>
    </view>
    <button class="account-primary" :loading="loading" :disabled="loading" @click="$emit('login')">
      <view v-if="!loading" class="wechat-mark" aria-hidden="true"><view class="bubble bubble-back"><view /><view /></view><view class="bubble bubble-front"><view /><view /></view></view>
      <text>{{ loading ? '登录中...' : '微信一键登录' }}</text>
    </button>
  </view>
</template>
<script>
export default { props: { loading: { type: Boolean, default: false } }, emits: ['login'] }
</script>
<style scoped>

.account-card { padding: 28rpx 26rpx; border-radius: 34rpx; background: #FFFEFA; box-shadow: 0 10rpx 28rpx rgba(168,125,33,.06); }
.account-row { display: flex; align-items: center; gap: 22rpx; }
.account-avatar { width: 116rpx; height: 116rpx; border-radius: 50%; background: #ECEBE8; flex-shrink: 0; }
.account-info { flex: 1; min-width: 0; }
.account-name { display: block; color: #282119; font-size: 34rpx; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.account-desc { display: block; margin-top: 6rpx; font-size: 24rpx; line-height: 1.5; color: #85828A; }
.account-primary { width: 100%; margin: 26rpx 0 0; padding: 14rpx 20rpx; min-height: 88rpx; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 20rpx; border-radius: 24rpx; line-height: 1.4; font-size: 32rpx; font-weight: 700; background: linear-gradient(110deg,#FFE68A,#FFECA8,#FFE17A); color: #553506; box-shadow: 0 3rpx 0 #FFDA65; }
.account-primary::after { border: 0; }
.account-primary[disabled] { background: #FFE9A0; color: #553506; opacity: .6; }

.wechat-mark { position: relative; width: 48rpx; height: 42rpx; flex-shrink: 0; }
.bubble { position: absolute; display: flex; justify-content: center; gap: 9rpx; box-sizing: border-box; padding-top: 9rpx; background: currentColor; border-radius: 50%; }
.bubble-back { width: 34rpx; height: 29rpx; left: 0; top: 0; }
.bubble-front { width: 29rpx; height: 26rpx; right: 0; bottom: 0; border: 2rpx solid #FFE9A0; }
.bubble::after { content: ''; position: absolute; bottom: -3rpx; left: 5rpx; border-top: 7rpx solid currentColor; border-right: 6rpx solid transparent; }
.bubble view { width: 4rpx; height: 4rpx; background: #FFE9A0; border-radius: 50%; }
</style>
