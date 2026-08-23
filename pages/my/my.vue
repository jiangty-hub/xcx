<template>
  <view class="page">
    <view v-if="!hasLogin">
      <notlogin :loading="authOperation === 'login'" @login="weixinLogin" />
    </view>

    <loggedin
      v-else
      :nickname="nickname"
      :avatar="avatar"
      :canManage="canManage"
      :busy="!!authOperation"
      :logoutLoading="authOperation === 'logout'"
      @goAddDish="goAddDish"
      @logout="logout"
      @editProfile="goEditProfile"
    />
  </view>
</template>

<script>
import notlogin from '@/components/notlogin.vue'
import loggedin from '@/components/loggedin.vue'
import {
  applyNewToken,
  checkManagePermission,
  clearAuthStorage,
  getAuthToken,
  isAuthExpiredResult,
  resolveCloudFileToUrl
} from '@/utils/auth.js'
import { getPendingCleanup, removePendingCleanup } from '@/utils/pending-cleanup.js'

const foodService = uniCloud.importObject('food-service')

export default {
  components: { notlogin, loggedin },

  data() {
    return {
      hasLogin: false,
      nickname: '',
      avatar: '', // 展示用 URL（tempFileURL 或 http(s)）
      uid: '',
      canManage: false,
      authOperation: '',
      refreshSeq: 0,
      refreshTask: null,
      lastRefreshAt: 0
    }
  },

  onShow() {
    this.refresh()
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
    async refresh({ force = false } = {}) {
      if (this.authOperation === 'logout') return
      if (this.authOperation === 'login' && !force) return

      const token = getAuthToken()
      if (!force && token && Date.now() - this.lastRefreshAt < 1000) return
      if (this.refreshTask) return this.refreshTask

      const seq = ++this.refreshSeq
      const task = this.performRefresh(token, seq)
      this.refreshTask = task

      try {
        return await task
      } finally {
        if (this.refreshTask === task) {
          this.refreshTask = null
        }
      }
    },

    async performRefresh(token, seq) {

      // 0) 没 token：直接未登录
      if (!token) {
        if (seq === this.refreshSeq) this.clearLoginState()
        return
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
        if (seq !== this.refreshSeq) return
        applyNewToken(r)

        // token 失效：清理并回到未登录
        if (isAuthExpiredResult(r)) {
          this.clearLoginState()
          return
        }

        // 其他错误：不踢下线（减少误判），继续用缓存兜底
        if (r.code !== 0) {
          console.log('get-user-profile failed:', r)
          if (!this.nickname) this.nickname = '用户'
          return
        }

        const profile = r.profile || {}
        const nextUid = r.uid || this.uid
        const cloudNickname = (profile.nickname || '').trim()
        const nextNickname = cloudNickname || this.nickname
        const cloudAvatar = profile.avatar || ''
        const avatarUrl = await resolveCloudFileToUrl(cloudAvatar)
        if (seq !== this.refreshSeq) return

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
      } catch (e) {
        // 网络/服务抖动：不踢下线，继续用缓存
        if (seq === this.refreshSeq) console.log('refresh error:', e)
      }

      if (seq !== this.refreshSeq) return
      if (!this.nickname) this.nickname = '用户'
      await this.refreshPermission(seq)
      if (seq === this.refreshSeq) this.lastRefreshAt = Date.now()
    },

    async refreshPermission(seq = this.refreshSeq) {
      if (seq !== this.refreshSeq) return
      const token = getAuthToken()
      if (!token) {
        this.canManage = false
        return
      }

      try {
        const permission = await checkManagePermission(foodService, token)
        if (seq !== this.refreshSeq) return
        if (permission.authExpired) {
          this.clearLoginState()
          return
        }
        this.canManage = permission.canManage
        if (this.canManage) await this.retryPendingFoodCleanup()
      } catch (e) {
        if (seq !== this.refreshSeq) return
        this.canManage = false
        console.error('permission check failed:', e)
        uni.showToast({ title: e?.message || '权限校验失败，请稍后重试', icon: 'none' })
      }
    },

    async retryPendingFoodCleanup() {
      const ids = getPendingCleanup('food')
      if (!ids.length) return

      try {
        const result = await foodService.cleanupUploadedCoverFiles(ids, getAuthToken())
        applyNewToken(result)
        const failed = new Set(Array.isArray(result?.failedFileIDs) ? result.failedFileIDs : [])
        const confirmed = result?.queued ? ids : ids.filter((id) => !failed.has(id))
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

      try {
        uni.showLoading({ title: '登录中...' })

        // 0) 获取微信用户信息（在点击链路里）
        const profile = await new Promise((resolve, reject) => {
          uni.getUserProfile({
            desc: '用于完善用户资料',
            success: resolve,
            fail: reject
          })
        })

        const ui = profile?.userInfo || {}
        let nickName = ui.nickName || ui.nickname || ''
        const avatarUrlFromWx = ui.avatarUrl || ui.avatar || ''

        if (nickName === '微信用户') nickName = ''

        // 1) 获取 code
        const loginRes = await new Promise((resolve, reject) => {
          uni.login({
            provider: 'weixin',
            success: resolve,
            fail: reject
          })
        })

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

        // 4) 先用微信头像作为展示缓存（秒出效果）
        if (avatarUrlFromWx) {
          this.avatar = avatarUrlFromWx
          uni.setStorageSync('uni_id_avatar', avatarUrlFromWx)
        }

        // 5) 云端是否已有 nickname？
        let cloudNickname = ''
        try {
          const pRes = await uniCloud.callFunction({
            name: 'get-user-profile',
            data: { token: getAuthToken() }
          })
          const pr = pRes.result || {}
          applyNewToken(pr)
          if (pr.code === 0) cloudNickname = pr.profile?.nickname || ''
        } catch (e) {
          console.log('get-user-profile in login failed:', e)
        }

        if (cloudNickname) {
          uni.setStorageSync('uni_id_nickname', cloudNickname)
        } else if (nickName) {
          // 初始化昵称（云端没昵称时）
          const uRes = await uniCloud.callFunction({
            name: 'update-user-profile',
            data: { token: getAuthToken(), nickname: nickName }
          })
          const ur = uRes.result || {}
          applyNewToken(ur)
          if (ur.code === 0) uni.setStorageSync('uni_id_nickname', nickName)
        } else {
          await this.promptSetNickname(getAuthToken())
        }

        await this.refresh({ force: true })
        uni.showToast({ title: '登录成功', icon: 'success' })
      } catch (e) {
        console.error(e)
        uni.showToast({ title: e.message || '登录失败', icon: 'none' })
      } finally {
        uni.hideLoading()
        this.authOperation = ''
      }
    },

    // 首次设置昵称（弹窗输入）
    async promptSetNickname(token) {
      return new Promise((resolve) => {
        uni.showModal({
          title: '设置昵称',
          editable: true,
          placeholderText: '请输入你的昵称',
          confirmText: '保存',
          success: async (r) => {
            try {
              if (r.confirm) {
                const name = (r.content || '').trim()
                if (!name) {
                  uni.showToast({ title: '昵称不能为空', icon: 'none' })
                  resolve()
                  return
                }
                const res = await uniCloud.callFunction({
                  name: 'update-user-profile',
                  data: { token, nickname: name }
                })
                const rr = res.result || {}
                applyNewToken(rr)
                if (rr.code !== 0) throw new Error(rr.msg || '保存失败')

                uni.setStorageSync('uni_id_nickname', name)
              }
            } catch (e) {
              console.error(e)
              uni.showToast({ title: e.message || '保存昵称失败', icon: 'none' })
            } finally {
              resolve()
            }
          },
          fail: () => resolve()
        })
      })
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
.page {
  min-height: 100vh;
  background: #f6f7fb;
}
</style>
