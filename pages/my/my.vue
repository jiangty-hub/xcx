<template>
  <view class="page">
    <view v-if="!hasLogin">
		<notlogin @login="weixinLogin" />
	</view>
    <loggedin v-else :nickname="nickname" :avatar="avatar" @goAddDish="goAddDish" @logout="logout" @editProfile="goEditProfile"/>
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
      avatar: '', // 展示用 URL（tempFileURL 或 qlogo URL）
      uid: ''
    }
  },
  onShow() {
    this.refresh()
  },
  methods: {
    // 把可能是 fileID 的 avatar 转成可展示的 URL
    async resolveAvatarToUrl(avatarValue) {
      if (!avatarValue) return ''

      // 如果已经是 http(s) URL（例如微信 qlogo），直接返回
      if (/^https?:\/\//i.test(avatarValue)) return avatarValue

      // 如果是云存储 fileID（cloud://...），转 temp url
      if (/^cloud:\/\//i.test(avatarValue)) {
        try {
          const tmp = await uniCloud.getTempFileURL({
            fileList: [avatarValue]
          })
          return tmp.fileList?.[0]?.tempFileURL || ''
        } catch (e) {
          console.log('getTempFileURL failed:', e)
          return ''
        }
      }

      // 其他未知格式：不展示
      return ''
    },

    async refresh() {
      const token = uni.getStorageSync('uni_id_token')
      this.hasLogin = !!token

      // 未登录：清空显示
      if (!this.hasLogin) {
        this.nickname = ''
        this.avatar = ''
        this.uid = ''
        return
      }

      // ① 已登录：先用缓存秒开
      this.nickname = uni.getStorageSync('uni_id_nickname') || ''
      this.avatar = uni.getStorageSync('uni_id_avatar') || ''
      this.uid = uni.getStorageSync('uni_id_uid') || ''

      // ② 再从云端拉取一次，保证跨设备/更新后也正确
      try {
        const res = await uniCloud.callFunction({
          name: 'get-user-profile',
          data: { token }
        })
        const r = res.result || {}
        if (r.code !== 0) throw new Error(r.msg || '获取用户信息失败')

        const profile = r.profile || {}

        this.uid = r.uid || this.uid
        this.nickname = profile.nickname || this.nickname || ''

        // profile.avatar 可能是 fileID 或 URL
        const avatarUrl = await this.resolveAvatarToUrl(profile.avatar || '')
        if (avatarUrl) this.avatar = avatarUrl

        // 写缓存（注意：avatar 缓存的是可展示 URL）
        uni.setStorageSync('uni_id_uid', this.uid)
        uni.setStorageSync('uni_id_nickname', this.nickname)
        uni.setStorageSync('uni_id_avatar', this.avatar)
      } catch (e) {
        console.log('refresh profile failed:', e)
      }

      // 兜底
      if (!this.nickname) this.nickname = '用户'
    },

    // 微信登录（mp-weixin）
    async weixinLogin() {
      let profile = null

      try {
        uni.showLoading({ title: '登录中...' })

        // 0) 必须在用户点击链路内：拿头像等信息（昵称可能被降级成“微信用户”）
        profile = await new Promise((resolve, reject) => {
          uni.getUserProfile({
            desc: '用于完善用户资料',
            success: resolve,
            fail: reject
          })
        })

        const ui = profile?.userInfo || {}
        let nickName = ui.nickName || ui.nickname || ''
        const avatarUrlFromWx = ui.avatarUrl || ui.avatar || ''

        // 微信降级昵称时会是“微信用户”，不要写入你的昵称字段
        if (nickName === '微信用户') nickName = ''

        // 1) 获取微信 code
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
        console.log('uni-id-cf result:', JSON.stringify(result, null, 2))
        if (result.code !== 0) throw new Error(result.msg || '登录失败')

        // 3) 保存 token/uid
        if (result.token) uni.setStorageSync('uni_id_token', result.token)
        if (result.uid) uni.setStorageSync('uni_id_uid', result.uid)

        // 4) 登录时：先把“微信头像 URL”作为展示用头像缓存（让用户立刻看到头像）
        if (avatarUrlFromWx) {
          this.avatar = avatarUrlFromWx
          uni.setStorageSync('uni_id_avatar', avatarUrlFromWx)
        }

        // 5) 只有【云端还没有 nickname】时才弹设置昵称
		let cloudNickname = ''
        try {
          const pRes = await uniCloud.callFunction({
            name: 'get-user-profile',
            data: { token: result.token }
          })
          const pr = pRes.result || {}
          if (pr.code === 0) {
            cloudNickname = pr.profile?.nickname || ''
          }
        } catch (e) {
          console.log('get-user-profile in login failed:', e)
        }
        
        // A) 云端已有昵称：直接用它，不弹窗
        if (cloudNickname) {
          uni.setStorageSync('uni_id_nickname', cloudNickname)
        }
        // B) 云端没昵称：如果拿到了“真实微信昵称”（很少），用它初始化
        else if (nickName) {
          await uniCloud.callFunction({
            name: 'update-user-profile',
            data: { token: result.token, nickname: nickName }
          })
          uni.setStorageSync('uni_id_nickname', nickName)
        }
        // C) 云端没昵称 + 微信也没给：这才弹一次让用户设置
        else {
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

    async logout() {
      try {
        await uniCloud.callFunction({
          name: 'uni-id-cf',
          data: { action: 'logout' }
        })
      } catch (e) {
        console.error(e)
      }

      uni.removeStorageSync('uni_id_token')
      uni.removeStorageSync('uni_id_uid')
      uni.removeStorageSync('uni_id_nickname')
      uni.removeStorageSync('uni_id_avatar')

      await this.refresh()
      uni.showToast({ title: '已退出', icon: 'none' })
    },

    goAddDish() {
      uni.navigateTo({ url: '/pages/dish/add' })
    },

    goEditProfile() {
      uni.navigateTo({ url: '/pages/profile/edit' })
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
