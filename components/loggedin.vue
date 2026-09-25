<template>
  <view class="account-card">
    <view class="account-row logged-row">
      <image class="account-avatar" :src="!avatarFailed && avatar ? avatar : '/static/avatar-default.png'" mode="aspectFill" @error="avatarFailed = true" />
      <view class="account-info"><text class="account-name">{{ nickname || '用户' }}</text><text class="account-desc">已登录</text></view>
      <button class="account-edit" :disabled="busy" @click="$emit('editProfile')">修改资料</button>
    </view>
    <button v-if="canManage" class="account-primary" :disabled="busy" @click="$emit('goAddDish')"><view class="add-mark" aria-hidden="true" /><text>新增菜品</text></button>
  </view>
</template>
<script>
export default {
  props: { nickname: { type: String, default: '' }, avatar: { type: String, default: '' }, canManage: { type: Boolean, default: false }, busy: { type: Boolean, default: false } },
  emits: ['goAddDish', 'editProfile'],
  data() { return { avatarFailed: false } },
  watch: { avatar() { this.avatarFailed = false } }
}
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

.logged-row { gap: 18rpx; flex-wrap: wrap; }
.logged-row .account-info { flex: 1 1 140rpx; }
.account-edit { margin: 0 0 0 auto; padding: 13rpx 20rpx; flex-shrink: 0; box-sizing: border-box; line-height: 1.4; font-size: 25rpx; border: 1rpx solid #E6E3DF; border-radius: 16rpx; color: #554F48; background: #F8F7F5; }
.account-edit::after { border: 0; }
.account-edit[disabled] { opacity: .55; }
.add-mark { position: relative; width: 42rpx; height: 42rpx; border-radius: 50%; flex-shrink: 0; background: #674301; }
.add-mark::before, .add-mark::after { content: ''; position: absolute; background: #FFE9A0; border-radius: 3rpx; }
.add-mark::before { width: 22rpx; height: 5rpx; top: 18rpx; left: 10rpx; }
.add-mark::after { width: 5rpx; height: 22rpx; left: 18rpx; top: 10rpx; }
</style>
