<template>
  <view class="page">
    <view v-if="!hasLogin">
      <notlogin @login="weixinLogin" />
    </view>

    <loggedin
      v-else
      :nickname="nickname"
      :avatar="avatar"
      @goAddDish="goAddDish"
      @logout="logout"
      @editProfile="goEditProfile"
    />
  </view>
</template>

<script>
import notlogin from '@/components/notlogin.vue'
import loggedin from '@/components/loggedin.vue'

export default {
  components: { notlogin, loggedin },

  data() {
    return {
      hasLogin: false,
      nickname: '',
      avatar: '', // 展示用 URL（tempFileURL 或 http(s)）
      uid: ''
    }
  },

  onShow() {
    this.refresh()
  },

  methods: {
    // ======= 基础工具：清理登录态 =======
    clearLoginState() {
      this.hasLogin = false
      this.nickname = ''
      this.avatar = ''
      this.uid = ''

      uni.removeStorageSync('uni_id_token')
      uni.removeStorageSync('uni_id_uid')
      uni.removeStorageSync('uni_id_nickname')
      uni.removeStorageSync('uni_id_avatar')
    },

    // ======= 基础工具：判断是否为“登录失效类”错误 =======
    isAuthExpiredResult(r) {
      const code = r?.code
      const msg = String(r?.msg || '')
      // ✅ 最干净：优先认 401
      if (code === 401) return true
      // ✅ 兜底：一些项目会返回其他 code 或 msg
      if (/token|未登录|登录|失效|过期|unauth|auth/i.test(msg)) return true
      return false
    },

    // ======= 基础工具：把可能是 fileID 的 avatar 转成可展示 URL =======
    async resolveAvatarToUrl(avatarValue) {
      if (!avatarValue) return ''

      if (/^https?:\/\//i.test(avatarValue)) return avatarValue

      if (/^cloud:\/\//i.test(avatarValue)) {
        try {
          const tmp = await uniCloud.getTempFileURL({ fileList: [avatarValue] })
          return tmp.fileList?.[0]?.tempFileURL || ''
        } catch (e) {
          console.log('getTempFileURL failed:', e)
          return ''
        }
      }

      return ''
    },

    // ======= 刷新：先缓存秒开，再云端校验 token + 拉最新资料 =======
    async refresh() {
      const token = uni.getStorageSync('uni_id_token')

      // 0) 没 token：直接未登录
      if (!token) {
        this.clearLoginState()
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

        // token 失效：清理并回到未登录
        if (this.isAuthExpiredResult(r)) {
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

        // uid
        this.uid = r.uid || this.uid

        // nickname：云端优先
        const cloudNickname = (profile.nickname || '').trim()
        if (cloudNickname) this.nickname = cloudNickname

        // avatar：可能是 URL 或 fileID
        const cloudAvatar = profile.avatar || ''
        const avatarUrl = await this.resolveAvatarToUrl(cloudAvatar)

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
        console.log('refresh error:', e)
      }

      if (!this.nickname) this.nickname = '用户'
    },

    // ======= 微信登录（mp-weixin） =======
    async weixinLogin() {
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
            data: { token: result.token }
          })
          const pr = pRes.result || {}
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
            data: { token: result.token, nickname: nickName }
          })
          const ur = uRes.result || {}
          if (ur.code === 0) uni.setStorageSync('uni_id_nickname', nickName)
        } else {
          await this.promptSetNickname(result.token)
        }

        await this.refresh()
        uni.showToast({ title: '登录成功', icon: 'success' })
      } catch (e) {
        console.error(e)
        uni.showToast({ title: e.message || '登录失败', icon: 'none' })
      } finally {
        uni.hideLoading()
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
      try {
        await uniCloud.callFunction({
          name: 'uni-id-cf',
          data: { action: 'logout' }
        })
      } catch (e) {
        console.error(e)
      }

      this.clearLoginState()
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
            this.refresh()
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
