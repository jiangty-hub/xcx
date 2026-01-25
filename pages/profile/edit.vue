<template>
  <view class="page">
    <view class="card">
      <text class="label">头像</text>

      <view class="avatar-row">
        <image class="avatar" :src="avatarPreview || '/static/avatar-default.png'" mode="aspectFill" />
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
      // avatarFileId：准备写进数据库的 fileID（cloud://...）
      avatarFileId: '',
      // avatarPreview：页面显示用的临时 URL（本地临时或云端 temp url）
      avatarPreview: '',
      saving: false
    }
  },

  async onLoad() {
    // 昵称用缓存即可
    this.nickname = uni.getStorageSync('uni_id_nickname') || ''

    // 头像：缓存里是 URL（秒开），先显示
    this.avatarPreview = uni.getStorageSync('uni_id_avatar') || ''

    // 如果你想进入编辑页时一定拿到 fileID（更严谨），可以从云端拉一遍：
    //（可选，推荐）
    await this.loadFromCloud()
  },

  methods: {
    async loadFromCloud() {
      const token = uni.getStorageSync('uni_id_token')
      if (!token) return

      try {
        const res = await uniCloud.callFunction({
          name: 'get-user-profile',
          data: { token }
        })
        const r = res.result || {}
        if (r.code !== 0) return

        const profile = r.profile || {}
        this.nickname = profile.nickname || this.nickname
        this.avatarFileId = profile.avatar || ''

        if (this.avatarFileId) {
          const tmp = await uniCloud.getTempFileURL({ fileList: [this.avatarFileId] })
          this.avatarPreview = tmp.fileList?.[0]?.tempFileURL || this.avatarPreview
        }
      } catch (e) {
        console.log('loadFromCloud failed:', e)
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

        // 立刻预览（本地临时路径）
        this.avatarPreview = localPath

        // 上传到 uniCloud 云存储
        uni.showLoading({ title: '上传中...' })

        const ext = (localPath.match(/\.\w+$/)?.[0] || '.jpg').toLowerCase()
        const cloudPath = `avatar/${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`

        const upload = await uniCloud.uploadFile({
          cloudPath,
          filePath: localPath
        })

        // 上传成功后拿到 fileID（cloud://...）
        this.avatarFileId = upload.fileID || ''

        // 为了更稳：把 fileID 再转成 temp url（避免本地路径失效）
        if (this.avatarFileId) {
          const tmp = await uniCloud.getTempFileURL({ fileList: [this.avatarFileId] })
          this.avatarPreview = tmp.fileList?.[0]?.tempFileURL || this.avatarPreview
        }

        uni.showToast({ title: '头像已上传', icon: 'success' })
      } catch (e) {
        console.error(e)
        // 用户取消也会进这里，提示别太吓人
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

      const token = uni.getStorageSync('uni_id_token')
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      try {
        this.saving = true
        uni.showLoading({ title: '保存中...' })

        const res = await uniCloud.callFunction({
          name: 'update-user-profile',
          data: {
            token,
            nickname: name,
            // ✅ 有头像就写 fileID，没有就不写
            avatar: this.avatarFileId || ''
          }
        })

        const r = res.result || {}
        if (r.code !== 0) throw new Error(r.msg || '保存失败')

        // 更新本地缓存（昵称 + 头像URL用于秒开）
        uni.setStorageSync('uni_id_nickname', name)
        uni.removeStorageSync('uni_id_avatar')
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
