<template>
  <view class="page">
    <view class="card">
      <text class="label">头像</text>

      <view class="avatar-row">
        <image
          class="avatar"
          :src="avatarPreview || '/static/avatar-default.png'"
          mode="aspectFill"
        />
        <button class="mini" size="mini" @click="chooseAvatar">更换头像</button>
      </view>

      <text class="label">昵称</text>
      <input class="input" v-model="nickname" placeholder="请输入昵称" maxlength="20" />

      <button class="btn" type="primary" :loading="saving" @click="save">保存</button>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      nickname: '',
      avatarFileId: '',     // 准备写进数据库的 cloud:// fileID
      avatarPreview: '',    // 展示用 URL（本地临时/云端 temp/http）
      avatarChanged: false, // 是否真的改过头像
      saving: false
    }
  },

  async onLoad() {
    // 1) 缓存秒开
    this.nickname = uni.getStorageSync('uni_id_nickname') || ''
    this.avatarPreview = uni.getStorageSync('uni_id_avatar') || ''

    // 2) 校验 token + 拉云端资料
    await this.loadFromCloud()
  },

  methods: {
    isAuthExpiredResult(r) {
      const code = r?.code
      const msg = String(r?.msg || '')
      if (code === 401) return true
      if (/token|未登录|登录|失效|过期|unauth|auth/i.test(msg)) return true
      return false
    },

    kickToLogin() {
      uni.removeStorageSync('uni_id_token')
      uni.removeStorageSync('uni_id_uid')
      uni.removeStorageSync('uni_id_nickname')
      uni.removeStorageSync('uni_id_avatar')

      uni.showToast({ title: '登录已失效，请重新登录', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 300)
    },

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

    async loadFromCloud() {
      const token = uni.getStorageSync('uni_id_token')
      if (!token) {
        this.kickToLogin()
        return
      }

      try {
        const res = await uniCloud.callFunction({
          name: 'get-user-profile',
          data: { token }
        })
        const r = res.result || {}

        if (this.isAuthExpiredResult(r)) {
          this.kickToLogin()
          return
        }

        if (r.code !== 0) {
          console.log('get-user-profile failed:', r)
          return
        }

        const profile = r.profile || {}
        const cloudNickname = (profile.nickname || '').trim()
        const cloudAvatar = profile.avatar || ''

        if (cloudNickname) this.nickname = cloudNickname

        // 如果云端头像是 fileID，保存 fileID 以便“不换头像也能保留”
        if (/^cloud:\/\//i.test(cloudAvatar)) {
          this.avatarFileId = cloudAvatar
        } else {
          this.avatarFileId = '' // 云端是 URL（如 qlogo）就不写
        }

        const url = await this.resolveAvatarToUrl(cloudAvatar)
        if (url) this.avatarPreview = url
        else if (!cloudAvatar) this.avatarPreview = '' // 云端明确为空才清空

        // 同步缓存（让上一页秒更新）
        if (this.nickname) uni.setStorageSync('uni_id_nickname', this.nickname)
        if (this.avatarPreview) uni.setStorageSync('uni_id_avatar', this.avatarPreview)
      } catch (e) {
        console.log('loadFromCloud error:', e)
      }
    },

    async chooseAvatar() {
      try {
        const chooseRes = await new Promise((resolve, reject) => {
          uni.chooseImage({
            count: 1,
            sizeType: ['compressed'],
            sourceType: ['album', 'camera'],
            success: resolve,
            fail: reject
          })
        })

        const localPath = chooseRes.tempFilePaths?.[0]
        if (!localPath) return

        // 立刻预览
        this.avatarPreview = localPath
        this.avatarChanged = true

        uni.showLoading({ title: '上传中...' })

        const ext = (localPath.match(/\.\w+$/)?.[0] || '.jpg').toLowerCase()
        const cloudPath = `avatar/${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`

        const upload = await uniCloud.uploadFile({
          cloudPath,
          filePath: localPath
        })

        this.avatarFileId = upload.fileID || ''

        // 将 fileID 转 temp url（避免本地临时路径失效）
        if (this.avatarFileId) {
          const tmp = await uniCloud.getTempFileURL({ fileList: [this.avatarFileId] })
          const url = tmp.fileList?.[0]?.tempFileURL || ''
          if (url) this.avatarPreview = url
        }

        uni.showToast({ title: '头像已上传', icon: 'success' })
      } catch (e) {
        console.error(e)
        uni.showToast({ title: '已取消', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },

    async save() {
      const name = (this.nickname || '').trim()
      if (!name) {
        uni.showToast({ title: '昵称不能为空', icon: 'none' })
        return
      }
      if (name.length > 20) {
        uni.showToast({ title: '昵称最长20字符', icon: 'none' })
        return
      }

      const token = uni.getStorageSync('uni_id_token')
      if (!token) {
        this.kickToLogin()
        return
      }

      try {
        this.saving = true
        uni.showLoading({ title: '保存中...' })

        // ✅ 最干净：只在“换过头像且有 fileID”时才传 avatar，避免任何误覆盖
        const data = { token, nickname: name }
        if (this.avatarChanged && this.avatarFileId) {
          data.avatar = this.avatarFileId
        }

        const res = await uniCloud.callFunction({
          name: 'update-user-profile',
          data
        })
        const r = res.result || {}

        if (this.isAuthExpiredResult(r)) {
          this.kickToLogin()
          return
        }
        if (r.code !== 0) throw new Error(r.msg || '保存失败')

        // ✅ 更新缓存，保证上一页立刻刷新
        uni.setStorageSync('uni_id_nickname', name)
        if (this.avatarPreview) uni.setStorageSync('uni_id_avatar', this.avatarPreview)
        else uni.removeStorageSync('uni_id_avatar')

        // ✅ 通知上一页刷新
        const ec = this.getOpenerEventChannel && this.getOpenerEventChannel()
        ec && ec.emit('profileUpdated')

        uni.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => uni.navigateBack(), 300)
      } catch (e) {
        console.error(e)
        uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      } finally {
        uni.hideLoading()
        this.saving = false
      }
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: #f6f7fb;
  padding: 24rpx;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
}
.label {
  display: block;
  font-size: 26rpx;
  color: #666;
  margin-bottom: 12rpx;
}
.avatar-row {
  display: flex;
  align-items: center;
  margin-bottom: 24rpx;
}
.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 60rpx;
  background: #eee;
}
.mini {
  margin-left: 18rpx;
}
.input {
  height: 88rpx;
  border: 1px solid #eee;
  border-radius: 12rpx;
  padding: 0 24rpx;
  background: #fafafa;
  margin-bottom: 24rpx;
}
.btn {
  border-radius: 12rpx;
}
</style>
