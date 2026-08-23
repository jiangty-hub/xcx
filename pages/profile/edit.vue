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
        <button class="mini" size="mini" :loading="avatarUploading" :disabled="avatarUploading || saving" @click="chooseAvatar">更换头像</button>
        <button class="mini" size="mini" :disabled="avatarUploading || saving" @click="clearAvatar">清除头像</button>
      </view>

      <text class="label">昵称</text>
      <input class="input" v-model="nickname" placeholder="请输入昵称" maxlength="20" />

      <button class="btn" type="primary" :loading="saving" :disabled="saving || avatarUploading" @click="save">保存</button>
    </view>
  </view>
</template>

<script>
import {
  applyNewToken,
  clearAuthStorage,
  getAuthToken,
  isAuthExpiredResult,
  resolveCloudFileToUrl
} from '@/utils/auth.js'
import { addPendingCleanup, getPendingCleanup, removePendingCleanup } from '@/utils/pending-cleanup.js'

export default {
  data() {
    return {
      nickname: '',
      avatarFileId: '',     // 准备写进数据库的 cloud:// fileID
      avatarPreview: '',    // 展示用 URL（本地临时/云端 temp/http）
      avatarChanged: false, // 是否真的改过头像
      pendingAvatarFileIds: [],
      avatarCleanupType: '',
      avatarUploading: false,
      saving: false
    }
  },

  async onLoad() {
    // 1) 缓存秒开
    this.nickname = uni.getStorageSync('uni_id_nickname') || ''
    this.avatarPreview = uni.getStorageSync('uni_id_avatar') || ''
    const cachedUid = uni.getStorageSync('uni_id_uid') || ''
    this.avatarCleanupType = cachedUid ? `avatar:${cachedUid}` : ''

    // 2) 校验 token + 拉云端资料
    await this.loadFromCloud()
    if (!this.avatarCleanupType) return
    this.pendingAvatarFileIds = getPendingCleanup(this.avatarCleanupType)
    await this.cleanupPendingAvatars()
  },

  onUnload() {
    // 保存/上传期间不发起删除请求，避免清理先于资料写库完成。
    // 待清理 fileID 已持久化，之后进入页面时会重新校验引用并清理。
    if (!this.saving && !this.avatarUploading) {
      this.cleanupPendingAvatars()
    }
  },

  onBackPress() {
    if (this.saving || this.avatarUploading) {
      uni.showToast({
        title: this.saving ? '正在保存，请稍候' : '头像上传中，请稍候',
        icon: 'none'
      })
      return true
    }
    return false
  },

  methods: {
    kickToLogin() {
      clearAuthStorage()

      uni.showToast({ title: '登录已失效，请重新登录', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 300)
    },

    async loadFromCloud() {
      const token = getAuthToken()
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
        applyNewToken(r)

        if (isAuthExpiredResult(r)) {
          this.kickToLogin()
          return
        }

        if (r.code !== 0) {
          console.log('get-user-profile failed:', r)
          return
        }

        if (r.uid) {
          uni.setStorageSync('uni_id_uid', r.uid)
          this.avatarCleanupType = `avatar:${r.uid}`
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

        const url = await resolveCloudFileToUrl(cloudAvatar)
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
      if (this.avatarUploading || this.saving) return

      const previousPreview = this.avatarPreview
      const previousFileId = this.avatarFileId
      const previousChanged = this.avatarChanged
      try {
        this.avatarUploading = true
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

        uni.showLoading({ title: '上传中...' })

        const ext = (localPath.match(/\.\w+$/)?.[0] || '.jpg').toLowerCase()
        const uid = uni.getStorageSync('uni_id_uid')
        if (!uid) throw new Error('登录已失效，请重新登录')
        if (!this.avatarCleanupType) this.avatarCleanupType = `avatar:${uid}`
        const cloudPath = `avatar/${uid}/${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`

        const upload = await uniCloud.uploadFile({
          cloudPath,
          filePath: localPath
        })

        this.avatarFileId = upload.fileID || ''
        if (!this.avatarFileId) throw new Error('头像上传失败')
        this.avatarChanged = true
        this.pendingAvatarFileIds.push(this.avatarFileId)
        addPendingCleanup(this.avatarCleanupType, [this.avatarFileId])

        // 将 fileID 转 temp url（避免本地临时路径失效）
        if (this.avatarFileId) {
          let url = ''
          try {
            const tmp = await uniCloud.getTempFileURL({ fileList: [this.avatarFileId] })
            url = tmp.fileList?.[0]?.tempFileURL || ''
          } catch (e) {
            console.error('resolve uploaded avatar failed:', e)
          }
          if (url) this.avatarPreview = url
        }

        uni.showToast({ title: '头像已上传', icon: 'success' })
      } catch (e) {
        this.avatarPreview = previousPreview
        this.avatarFileId = previousFileId
        this.avatarChanged = previousChanged
        const message = String(e?.errMsg || e?.message || '')
        if (/cancel/i.test(message)) {
          uni.showToast({ title: '已取消', icon: 'none' })
        } else {
          console.error(e)
          uni.showToast({ title: e?.message || '头像上传失败，请重试', icon: 'none' })
        }
      } finally {
        uni.hideLoading()
        this.avatarUploading = false
      }
    },

    clearAvatar() {
      if (this.avatarUploading || this.saving) return
      this.avatarFileId = ''
      this.avatarPreview = ''
      this.avatarChanged = true
    },

    async save() {
      if (this.saving || this.avatarUploading) return

      const name = (this.nickname || '').trim()
      if (!name) {
        uni.showToast({ title: '昵称不能为空', icon: 'none' })
        return
      }
      if (name.length > 20) {
        uni.showToast({ title: '昵称最长20字符', icon: 'none' })
        return
      }

      const token = getAuthToken()
      if (!token) {
        this.kickToLogin()
        return
      }

      try {
        this.saving = true
        uni.showLoading({ title: '保存中...' })

        // ✅ 最干净：只在“换过头像且有 fileID”时才传 avatar，避免任何误覆盖
        const data = { token, nickname: name }
        if (this.avatarChanged) {
          data.avatar = this.avatarFileId
        }
        const pendingToRemove = this.pendingAvatarFileIds.filter((id) => id !== this.avatarFileId)
        if (pendingToRemove.length) data.cleanupAvatarFileIds = pendingToRemove

        const res = await uniCloud.callFunction({
          name: 'update-user-profile',
          data
        })
        const r = res.result || {}
        applyNewToken(r)

        if (isAuthExpiredResult(r)) {
          this.kickToLogin()
          return
        }
        if (r.code !== 0) throw new Error(r.msg || '保存失败')

        const failed = r.cleanup?.queued === true
          ? []
          : (Array.isArray(r.cleanup?.failedFileIDs) ? r.cleanup.failedFileIDs : [])
        const currentCommitted = this.avatarFileId ? [this.avatarFileId] : []
        const confirmed = pendingToRemove.filter((id) => !failed.includes(id))
        removePendingCleanup(this.avatarCleanupType, [...confirmed, ...currentCommitted])
        addPendingCleanup(this.avatarCleanupType, failed)
        this.pendingAvatarFileIds = getPendingCleanup(this.avatarCleanupType)

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
    },

    async cleanupPendingAvatars() {
      const ids = [...new Set(this.pendingAvatarFileIds)].filter(Boolean)
      if (!ids.length || !this.avatarCleanupType) return

      addPendingCleanup(this.avatarCleanupType, ids)
      const token = getAuthToken()
      if (!token) return

      try {
        const res = await uniCloud.callFunction({
          name: 'update-user-profile',
          data: { token, cleanupAvatarFileIds: ids }
        })
        const result = res.result || {}
        applyNewToken(result)
        if (result.code !== 0) return

        const failed = new Set(result.cleanup?.queued === true
          ? []
          : (Array.isArray(result.cleanup?.failedFileIDs) ? result.cleanup.failedFileIDs : []))
        const confirmed = ids.filter((id) => !failed.has(id))
        removePendingCleanup(this.avatarCleanupType, confirmed)
        this.pendingAvatarFileIds = getPendingCleanup(this.avatarCleanupType)
      } catch (e) {
        console.error('cleanup pending avatar files failed:', e)
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
