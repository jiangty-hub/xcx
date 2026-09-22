<template>
  <view class="page">
    <view v-if="!profileReady" class="init-state">
      <text>{{ initError || '资料加载中，请稍候...' }}</text>
      <button v-if="initError" size="mini" :disabled="initializing" @click="initializeProfile">重试</button>
    </view>
    <view class="card">
      <text class="label">头像</text>

      <view class="avatar-row">
        <image
          class="avatar"
          :src="avatarPreview || '/static/avatar-default.png'"
          mode="aspectFill"
        />
        <button class="mini" size="mini" :loading="avatarUploading" :disabled="formDisabled" @click="chooseAvatar">更换头像</button>
        <button class="mini" size="mini" :disabled="formDisabled" @click="clearAvatar">清除头像</button>
      </view>

      <text class="label">昵称</text>
      <input class="input" v-model="nickname" :disabled="formDisabled" @input="nicknameEdited = true" placeholder="请输入昵称" maxlength="20" />

      <button class="btn" type="primary" :loading="saving" :disabled="formDisabled" @click="save">保存</button>
    </view>
  </view>
</template>

<script>
import { beginLoading } from '@/utils/loading.js'
import leaveGuard from '@/utils/leave-guard.js'
import {
  applyNewToken,
  clearAuthStorage,
  getAuthToken,
  isAuthExpiredResult,
  resolveCloudFileToUrl
} from '@/utils/auth.js'
import { addPendingCleanup, getPendingCleanup, removePendingCleanup } from '@/utils/pending-cleanup.js'

export default {
  mixins: [leaveGuard],

  computed: {
    formDisabled() {
      return !this.profileReady || this.initializing || this.pageDisposed ||
        this.leaveGuardLeaving || this.saving || this.avatarUploading
    },
    leaveGuardMessage() {
      if (this.saving) return '正在保存，离开后请确认保存结果。'
      if (this.avatarUploading) return '头像上传中，离开可能丢失本次上传。'
      return this.nicknameEdited || this.avatarChanged
        ? '资料尚未保存，离开将丢失本次修改。' : ''
    }
  },

  data() {
    return {
      initializing: false,
      profileReady: false,
      initError: '',
      pageDisposed: false,
      nickname: '',
      nicknameEdited: false,
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

    // 完成资料读取和历史头像清理后，才允许编辑本次资料。
    await this.initializeProfile()
  },

  onUnload() {
    this.pageDisposed = true
    // 保存/上传期间不发起删除请求，避免清理先于资料写库完成。
    // 待清理 fileID 已持久化，之后进入页面时会重新校验引用并清理。
    if (this.profileReady && !this.saving && !this.avatarUploading) {
      this.cleanupPendingAvatars()
    }
  },

  onBackPress() {
    if (this.leaveGuardLeaving) return false
    if (this.saving || this.avatarUploading) {
      return true
    }
    return false
  },

  methods: {
    async initializeProfile() {
      if (this.initializing || this.profileReady || this.pageDisposed) return
      this.initializing = true
      this.initError = ''
      try {
        const loaded = await this.loadFromCloud()
        if (!loaded || this.pageDisposed) return
        this.pendingAvatarFileIds = getPendingCleanup(this.avatarCleanupType)
        // 等旧任务结束后再解锁，避免新上传的头像被初始化清理误处理。
        // 清理失败由原有持久化记录留待重试，不阻止资料编辑。
        await this.cleanupPendingAvatars()
        if (!this.pageDisposed && !this.initError) this.profileReady = true
      } catch (error) {
        if (this.pageDisposed) return
        console.error('initialize profile failed:', error)
        this.initError = '资料加载失败，请重试'
      } finally {
        this.initializing = false
      }
    },

    kickToLogin() {
      if (this.pageDisposed) return
      this.profileReady = false
      this.initError = '登录已失效，请重新登录'
      clearAuthStorage()

      uni.showToast({ title: '登录已失效，请重新登录', icon: 'none' })
      setTimeout(() => this.leavePageWithoutAlert(), 300)
    },

    async loadFromCloud() {
      const token = getAuthToken()
      if (!token) {
        this.kickToLogin()
        return false
      }

      const res = await uniCloud.callFunction({
        name: 'get-user-profile',
        data: { token }
      })
      if (this.pageDisposed) return false
      const r = res.result || {}
      applyNewToken(r)
      if (isAuthExpiredResult(r)) {
        this.kickToLogin()
        return false
      }
      if (r.code !== 0 || !r.uid) throw new Error(r.msg || '资料读取失败')

      const profile = r.profile || {}
      const cloudNickname = (profile.nickname || '').trim()
      const cloudAvatar = profile.avatar || ''
      const url = await resolveCloudFileToUrl(cloudAvatar)
      if (this.pageDisposed) return false

      // 初始化期间表单锁定；异步步骤全部结束后再回填。
      this.nickname = cloudNickname
      this.avatarCleanupType = 'avatar:' + r.uid
      this.avatarFileId = String(cloudAvatar).toLowerCase().startsWith('cloud://') ? cloudAvatar : ''
      if (url) this.avatarPreview = url
      else if (!cloudAvatar) this.avatarPreview = ''

      uni.setStorageSync('uni_id_uid', r.uid)
      uni.setStorageSync('uni_id_nickname', this.nickname)
      if (this.avatarPreview) uni.setStorageSync('uni_id_avatar', this.avatarPreview)
      else uni.removeStorageSync('uni_id_avatar')
      return true
    },

    async chooseAvatar() {
      if (this.formDisabled) return

      const previousPreview = this.avatarPreview
      const previousFileId = this.avatarFileId
      const previousChanged = this.avatarChanged
      let stopLoading = async () => {}
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

        stopLoading = beginLoading('上传中...')

        const ext = (localPath.match(/\.\w+$/)?.[0] || '.jpg').toLowerCase()
        const uid = uni.getStorageSync('uni_id_uid')
        if (!uid) throw new Error('登录已失效，请重新登录')
        if (!this.avatarCleanupType) this.avatarCleanupType = `avatar:${uid}`
        const cloudPath = `avatar/${uid}/${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`

        const upload = await uniCloud.uploadFile({
          cloudPath,
          cloudPathAsRealPath: true,
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

        await stopLoading()
        uni.showToast({ title: '头像已上传', icon: 'success' })
      } catch (e) {
        this.avatarPreview = previousPreview
        this.avatarFileId = previousFileId
        this.avatarChanged = previousChanged
        await stopLoading()
        const message = String(e?.errMsg || e?.message || '')
        if (/cancel/i.test(message)) {
          uni.showToast({ title: '已取消', icon: 'none' })
        } else {
          console.error(e)
          uni.showToast({ title: e?.message || '头像上传失败，请重试', icon: 'none' })
        }
      } finally {
        await stopLoading()
        this.avatarUploading = false
      }
    },

    clearAvatar() {
      if (this.formDisabled) return
      this.avatarFileId = ''
      this.avatarPreview = ''
      this.avatarChanged = true
    },

    async save() {
      if (this.formDisabled) return

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

      const stopLoading = beginLoading('保存中...')
      try {
        this.saving = true

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
          await stopLoading()
          this.kickToLogin()
          return
        }
        if (r.code !== 0) throw new Error(r.msg || '保存失败')

        this.applyAvatarCleanup(r.cleanup, this.avatarChanged && this.avatarFileId ? [this.avatarFileId] : [])

        // ✅ 更新缓存，保证上一页立刻刷新
        uni.setStorageSync('uni_id_nickname', name)
        if (this.avatarPreview) uni.setStorageSync('uni_id_avatar', this.avatarPreview)
        else uni.removeStorageSync('uni_id_avatar')

        // ✅ 通知上一页刷新
        const ec = this.getOpenerEventChannel && this.getOpenerEventChannel()
        ec && ec.emit('profileUpdated')

        this.nicknameEdited = false
        this.avatarChanged = false
        await stopLoading()
        await this.preparePageLeave()
        uni.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => this.leavePageWithoutAlert(), 300)
      } catch (e) {
        console.error(e)
        await stopLoading()
        uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      } finally {
        await stopLoading()
        this.saving = false
      }
    },

    applyAvatarCleanup(cleanup, committed = []) {
      if (!this.avatarCleanupType) return
      // 不以“失败列表为空”推断成功；旧版后端缺少确认字段时保留记录。
      const confirmed = Array.isArray(cleanup?.confirmedFileIDs) ? cleanup.confirmedFileIDs : []
      const unresolved = [
        ...(Array.isArray(cleanup?.failedFileIDs) ? cleanup.failedFileIDs : []),
        ...(Array.isArray(cleanup?.skippedFileIDs) ? cleanup.skippedFileIDs : [])
      ]
      addPendingCleanup(this.avatarCleanupType, unresolved)
      removePendingCleanup(this.avatarCleanupType, [...confirmed, ...committed])
      this.pendingAvatarFileIds = getPendingCleanup(this.avatarCleanupType)
      if (cleanup?.skippedFileIDs?.length) console.warn('头像文件待核对：', cleanup.skipReason)
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
        if (this.pageDisposed && this.initializing) return
        const result = res.result || {}
        applyNewToken(result)
        if (isAuthExpiredResult(result)) {
          this.kickToLogin()
          return
        }
        if (result.code !== 0) return

        this.applyAvatarCleanup(result.cleanup)

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
.init-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 20rpx 0;
  color: #888;
  font-size: 26rpx;
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
