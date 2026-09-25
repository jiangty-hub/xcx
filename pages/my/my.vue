<template>
  <view class="kitchen-page">
    <view class="kitchen-heading">
      <image v-if="!titleFailed" class="kitchen-title" src="/static/my/kitchen-title.png" mode="aspectFit" aria-label="我的小厨房，好好吃饭，记录家的味道" @error="titleFailed = true" />
      <view v-else class="heading-fallback"><text class="heading-name">我的小厨房</text><text class="heading-desc">好好吃饭，记录家的味道</text></view>
    </view>
    <notlogin v-if="!hasLogin" :loading="authOperation === 'login'" @login="weixinLogin" />
    <loggedin v-else :nickname="nickname" :avatar="avatar" :canManage="canManage" :busy="!!authOperation"
      @goAddDish="goAddDish" @editProfile="goEditProfile" />
    <view class="kitchen-art" :class="{ 'art-unavailable': chefFailed }">
      <image v-if="!chefFailed" class="kitchen-chef" src="/static/my/kitchen-chef.png" mode="aspectFit" aria-label="约克夏厨师正在煮菜" @error="chefFailed = true" />
    </view>
    <button v-if="hasLogin" class="logout-button" :loading="authOperation === 'logout'" :disabled="!!authOperation" @click="logout">{{ authOperation === 'logout' ? '退出中...' : '退出登录' }}</button>
  </view>
</template>

<script>
import { syncTabBar } from '@/utils/tab-bar.js'
import { beginLoading } from '@/utils/loading.js'
import notlogin from '@/components/notlogin.vue'
import loggedin from '@/components/loggedin.vue'
import {
  applyNewToken,
  checkManagePermission,
  clearAuthStorage,
  getAuthToken,
  resolveCloudFileToUrl
} from '@/utils/auth.js'
import { getPendingCleanup, removePendingCleanup } from '@/utils/pending-cleanup.js'
import { getResumeRefreshState } from '@/utils/resume-refresh.js'

const foodService = uniCloud.importObject('food-service', { customUI: true })

export default {
  components: { notlogin, loggedin },

  data() {
    return {
      hasLogin: false,
      titleFailed: false,
      chefFailed: false,
      nickname: '',
      avatar: '', // 展示用 URL（tempFileURL 或 http(s)）
      uid: '',
      canManage: false,
      authOperation: '',
      refreshSeq: 0,
      refreshTask: null,
      lastRefreshAt: 0,
      lastResumeSeqHandled: 0
    }
  },

  onLoad() {
    this.lastResumeSeqHandled = getResumeRefreshState(0).seq
  },

  onReady() {
    syncTabBar(this, 2)
  },
  async onShow() {
    syncTabBar(this, 2)
    const resume = getResumeRefreshState(this.lastResumeSeqHandled)
    if (resume.seq) this.lastResumeSeqHandled = resume.seq

    if (resume.level >= 2) {
      const authTask = getApp()?.globalData?.authRefreshTask
      if (authTask) {
        try {
          await authTask
        } catch (e) {
          console.log('wait resume auth validation failed:', e)
        }
      }
    }

    await this.refresh({ force: resume.shouldRefresh })
  },

  methods: {
    // ======= 基础工具：清理登录态 =======
    clearLoginState() {
      this.refreshSeq += 1
      this.lastRefreshAt = 0
      this.hasLogin = false
      this.nickname = ''
      this.avatar = ''
      this.uid = ''
      this.canManage = false

      clearAuthStorage()
    },

    // ======= 刷新：先缓存秒开，再云端校验 token + 拉最新资料 =======
    async refresh({ force = false, silent = false } = {}) {
      if (this.authOperation === 'logout') return { status: 'skipped' }
      if (this.authOperation === 'login' && !force) return { status: 'skipped' }

      const token = getAuthToken()
      if (!force && token && Date.now() - this.lastRefreshAt < 1000) return { status: 'skipped' }
      if (this.refreshTask) return this.refreshTask

      const seq = ++this.refreshSeq
      const task = this.performRefresh(token, seq)
      this.refreshTask = task

      try {
        const result = await task
        if (!silent && this.authOperation !== 'login') {
          const toast = this.getRefreshToast(result)
          if (toast) uni.showToast(toast)
        }
        return result
      } finally {
        if (this.refreshTask === task) {
          this.refreshTask = null
        }
      }
    },

    async performRefresh(token, seq) {
      const result = { status: 'partial', profileLoaded: false, permissionLoaded: false }
      if (seq !== this.refreshSeq) return { ...result, status: 'skipped' }

      // 0) 没 token：直接未登录
      if (!token) {
        if (seq === this.refreshSeq) this.clearLoginState()
        return { ...result, status: 'expired', missingToken: true }
      }

      // 1) 有 token：先用缓存秒开（不闪）
      this.hasLogin = true
      this.nickname = uni.getStorageSync('uni_id_nickname') || ''
      this.avatar = uni.getStorageSync('uni_id_avatar') || ''
      this.uid = uni.getStorageSync('uni_id_uid') || ''

      // 2) 云端校验 + 拉取（关键：解决“假登录”）
      try {
        const res = await uniCloud.callFunction({
          name: 'get-user-profile',
          data: { token }
        })
        const r = res.result || {}
        if (seq !== this.refreshSeq) return { ...result, status: 'skipped' }
        applyNewToken(r)

        // token 失效：清理并回到未登录
        if (Number(r.code) === 401) {
          this.clearLoginState()
          return { ...result, status: 'expired' }
        }

        // 其他错误：不踢下线（减少误判），继续用缓存兜底
        if (r.code !== 0) {
          console.log('get-user-profile failed:', r)
        } else {
          const profile = r.profile || {}
          const nextUid = r.uid || this.uid
          const cloudNickname = (profile.nickname || '').trim()
          const nextNickname = cloudNickname || this.nickname
          const cloudAvatar = profile.avatar || ''
          const avatarUrl = await resolveCloudFileToUrl(cloudAvatar)
          if (seq !== this.refreshSeq) return { ...result, status: 'skipped' }

          this.uid = nextUid
          this.nickname = nextNickname
          if (avatarUrl) {
            this.avatar = avatarUrl
          } else if (!cloudAvatar) {
            // 云端明确为空：清空展示
            this.avatar = ''
          }
          // 若 cloudAvatar 有值但转 URL 失败：不覆盖本地缓存，减少误判

          // 写缓存（头像缓存可展示 URL）
          uni.setStorageSync('uni_id_uid', this.uid)
          uni.setStorageSync('uni_id_nickname', this.nickname || '')
          if (this.avatar) uni.setStorageSync('uni_id_avatar', this.avatar)
          else uni.removeStorageSync('uni_id_avatar')
          result.profileLoaded = !cloudAvatar || !!avatarUrl
        }
      } catch (e) {
        // 网络/服务抖动：不踢下线，继续用缓存
        if (seq === this.refreshSeq) console.log('refresh error:', e)
      }

      if (seq !== this.refreshSeq) return { ...result, status: 'skipped' }
      if (!this.nickname) this.nickname = '用户'
      // 资料读取失败也继续校验权限，只有登录失效才结束流程。
      const permission = await this.refreshPermission(seq)
      if (permission.status === 'expired') return { ...result, status: 'expired' }
      if (seq !== this.refreshSeq) return { ...result, status: 'skipped' }
      result.permissionLoaded = permission.permissionLoaded
      result.status = result.profileLoaded && result.permissionLoaded ? 'success' : 'partial'
      this.lastRefreshAt = result.status === 'success' ? Date.now() : 0
      return result
    },

    async refreshPermission(seq = this.refreshSeq) {
      if (seq !== this.refreshSeq) return { status: 'skipped', permissionLoaded: false }
      const token = getAuthToken()
      if (!token) {
        this.clearLoginState()
        return { status: 'expired', permissionLoaded: false }
      }

      try {
        const permission = await checkManagePermission(foodService, token)
        if (seq !== this.refreshSeq) return { status: 'skipped', permissionLoaded: false }
        if (permission.authExpired) {
          this.clearLoginState()
          return { status: 'expired', permissionLoaded: false }
        }
        this.canManage = permission.canManage
        if (this.canManage) await this.retryPendingFoodCleanup()
        return { status: 'success', permissionLoaded: true }
      } catch (e) {
        if (seq !== this.refreshSeq) return { status: 'skipped', permissionLoaded: false }
        this.canManage = false
        console.error('permission check failed:', e)
        return { status: 'partial', permissionLoaded: false }
      }
    },

    // 登录时由登录入口统一提示，普通页面刷新只提示异常。
    getRefreshToast(result, login = false) {
      if (!result || result.status === 'skipped') return null
      if (result.status === 'expired') {
        if (result.missingToken && !login) return null
        return { title: '登录已失效，请重新登录', icon: 'none' }
      }
      if (!result.permissionLoaded) {
        return {
          title: login ? '已登录，管理权限获取失败，请稍后重试' : '管理权限获取失败，请稍后重试',
          icon: 'none'
        }
      }
      if (!result.profileLoaded) {
        return { title: login ? '登录成功，资料暂未更新' : '资料暂未更新，请稍后重试', icon: 'none' }
      }
      return login ? { title: '登录成功', icon: 'success' } : null
    },

    async retryPendingFoodCleanup() {
      const ids = getPendingCleanup('food')
      if (!ids.length) return

      try {
        const result = await foodService.cleanupUploadedCoverFiles(ids, getAuthToken())
        applyNewToken(result)
        const confirmedSet = new Set(Array.isArray(result?.confirmedFileIDs) ? result.confirmedFileIDs : [])
        const confirmed = ids.filter((id) => confirmedSet.has(id))
        if (result?.skipped) console.warn('部分待清理图片未处理：', result.skipReason, result.skippedFileIDs)
        removePendingCleanup('food', confirmed)
      } catch (e) {
        console.error('retry pending food cover cleanup failed:', e)
      }
    },

    // ======= 微信登录（mp-weixin） =======
    async weixinLogin() {
      if (this.authOperation) return
      this.authOperation = 'login'
      this.refreshSeq += 1
      this.refreshTask = null
      this.lastRefreshAt = 0
      let toast = null
      const stopLoading = beginLoading('登录中...')

      try {

        // 1) 直接获取登录凭证，昵称和头像不作为登录前提
        const loginRes = await new Promise((resolve, reject) => {
          uni.login({
            provider: 'weixin',
            success: resolve,
            fail: reject
          })
        })

        if (!loginRes.code) throw new Error('未获取到微信登录凭证，请重试')

        // 2) 调 uni-id-cf 登录
        const res = await uniCloud.callFunction({
          name: 'uni-id-cf',
          data: {
            action: 'loginByWeixin',
            params: { code: loginRes.code }
          }
        })

        const result = res.result || {}
        if (result.code !== 0) throw new Error(result.msg || '登录失败')
        applyNewToken(result)

        // 3) 保存 token/uid
        if (result.token) uni.setStorageSync('uni_id_token', result.token)
        if (result.uid) uni.setStorageSync('uni_id_uid', result.uid)

        // 4) 读取已有资料；未设置时使用默认展示，可在“修改资料”中完善
        const refreshResult = await this.refresh({ force: true, silent: true })
        toast = this.getRefreshToast(refreshResult, true)
      } catch (e) {
        console.error(e)
        toast = { title: e?.message || e?.errMsg || '登录失败', icon: 'none' }
      } finally {
        await stopLoading()
        this.authOperation = ''
      }
      if (toast) uni.showToast(toast)
    },

    // ======= 退出登录 =======
    async logout() {
      if (this.authOperation) return
      this.authOperation = 'logout'
      this.refreshSeq += 1
      this.refreshTask = null

      try {
        await uniCloud.callFunction({
          name: 'uni-id-cf',
          data: { action: 'logout' }
        })
      } catch (e) {
        console.error(e)
      } finally {
        this.clearLoginState()
        this.authOperation = ''
      }

      uni.showToast({ title: '已退出', icon: 'none' })
    },

    // ======= 页面跳转 =======
    goAddDish() {
      uni.navigateTo({ url: '/pages/addDish/addDish?mode=add' })
    },

    // ✅ eventChannel：edit 保存后通知我刷新
    goEditProfile() {
      uni.navigateTo({
        url: '/pages/profile/edit',
        success: (res) => {
          res.eventChannel.on('profileUpdated', () => {
            this.refresh({ force: true })
          })
        }
      })
    }
  }
}
</script>

<style scoped>
.kitchen-page { min-height: 100vh; box-sizing: border-box; background: #FFFBEB; padding: 30rpx 28rpx 32rpx; color: #382518; }
/* The shared tab bar owns its opaque safe-area background. Reserve its full height here. */
/* #ifdef MP-WEIXIN */
.kitchen-page { padding-bottom: calc(152rpx + env(safe-area-inset-bottom)); }
/* #endif */
.kitchen-heading { margin: 8rpx 0 24rpx; }
.kitchen-title { display: block; width: 100%; height: 232rpx; }
.heading-fallback { min-height: 232rpx; display: flex; flex-direction: column; justify-content: center; gap: 16rpx; }
.heading-name { font-size: 64rpx; font-weight: 900; color: #382518; }
.heading-desc { font-size: 29rpx; color: #58412A; }
.kitchen-art { margin: 36rpx auto 24rpx; width: 100%; max-width: 680rpx; }
.kitchen-chef { display: block; width: 100%; height: 650rpx; }
.art-unavailable { height: 80rpx; }
.logout-button { width: 100%; box-sizing: border-box; margin: 32rpx 0 20rpx; padding: 0 18rpx; height: 88rpx; display: flex; align-items: center; justify-content: center; line-height: 1.3; border: 2rpx solid #FF5151; border-radius: 20rpx; background: #FFF5EF; color: #FF5151; font-size: 32rpx; font-weight: 700; }
.logout-button::after { border: 0; }
.logout-button[disabled] { color: #FF5151; background: #FFF5EF; opacity: .55; }
</style>
