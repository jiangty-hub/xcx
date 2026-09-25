<template>
  <view class="profile-page">
    <view class="profile-heading">
      <view class="heading-row"><text class="heading-title">个人资料</text><image v-if="!badgeFailed" class="chef-badge" src="/static/detail/chef-badge.png" mode="aspectFit" @error="badgeFailed = true" /></view>
      <text class="heading-subtitle">换个头像，认识一下</text>
    </view>
    <view v-if="!profileReady" class="init-state">
      <text>{{ initError || '资料加载中，请稍候...' }}</text>
      <button v-if="initError" class="retry-button" size="mini" :disabled="initializing" @click="initializeProfile">重试</button>
    </view>
    <view class="profile-card">
      <text class="field-label">头像</text>
      <view class="avatar-row">
        <image class="avatar" :src="!avatarFailed && avatarPreview ? avatarPreview : '/static/avatar-default.png'" mode="aspectFill" @error="avatarFailed = true" />
        <view class="avatar-actions">
          <button class="avatar-button change-button" :loading="avatarUploading" :disabled="formDisabled" @click="chooseAvatar"><text v-if="!avatarUploading" class="picture-icon" aria-hidden="true">▧</text><text>{{ avatarUploading ? '处理中...' : '更换头像' }}</text></button>
          <button class="avatar-button clear-button" :disabled="formDisabled" @click="clearAvatar"><view class="trash-icon" aria-hidden="true"><view /></view><text>清除头像</text></button>
        </view>
      </view>
      <text v-if="avatarChanged && !avatarUploading" class="avatar-hint">{{ avatarFileId ? '新头像已上传，保存后生效' : '头像已清除，保存后生效' }}</text>
      <view class="nickname-section">
        <text class="field-label">昵称</text>
        <input class="nickname-input" v-model="nickname" :disabled="formDisabled" @input="nicknameEdited = true" placeholder="请输入昵称" placeholder-class="nickname-placeholder" maxlength="20" :cursor-spacing="32" confirm-type="done" />
        <button class="save-button" :loading="saving" :disabled="formDisabled" @click="save">{{ saving ? '保存中...' : '保存' }}</button>
      </view>
    </view>
    <view class="paw-decoration" aria-hidden="true"><view class="paw paw-one"><view class="toe toe-a" /><view class="toe toe-b" /><view class="toe toe-c" /><view class="toe toe-d" /><view class="paw-pad" /></view><view class="paw paw-two"><view class="toe toe-a" /><view class="toe toe-b" /><view class="toe toe-c" /><view class="toe toe-d" /><view class="paw-pad" /></view></view>
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
      avatarFailed: false,
      badgeFailed: false,
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

  watch: { avatarPreview() { this.avatarFailed = false } },

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
        if (!localPath || this.pageDisposed) return

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
        // Persist a completed upload even after leaving; clean it through the existing queue.
        if (this.pageDisposed) return

        // 将 fileID 转 temp url（避免本地临时路径失效）
        if (this.avatarFileId) {
          let url = ''
          try {
            const tmp = await uniCloud.getTempFileURL({ fileList: [this.avatarFileId] })
            url = tmp.fileList?.[0]?.tempFileURL || ''
          } catch (e) {
            console.error('resolve uploaded avatar failed:', e)
          }
          if (this.pageDisposed) return
          if (url) this.avatarPreview = url
        }

        await stopLoading()
        if (!this.pageDisposed) uni.showToast({ title: '头像已上传，请保存', icon: 'none' })
      } catch (e) {
        if (this.pageDisposed) return
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

        if (this.pageDisposed) return

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
        if (!this.pageDisposed) uni.showToast({ title: e.message || '保存失败', icon: 'none' })
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

<style>page { background: #FFFBEB; }</style>
<style scoped>
.profile-page { min-height: 100vh; box-sizing: border-box; background: #FFFBEB; padding: 30rpx 28rpx calc(28rpx + env(safe-area-inset-bottom)); color: #422919; }
.profile-heading { padding: 4rpx 8rpx 30rpx; }
.heading-row { display: flex; align-items: center; gap: 18rpx; }
.heading-title { font-size: 50rpx; font-weight: 800; line-height: 1.3; }
.chef-badge { width: 108rpx; height: 112rpx; flex-shrink: 0; }
.heading-subtitle { display: block; color: #948776; font-size: 27rpx; line-height: 1.5; margin-top: -2rpx; }
.init-state { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-bottom: 20rpx; padding: 20rpx; border-radius: 18rpx; color: #846530; background: #FFF1C5; font-size: 25rpx; line-height: 1.5; }
.retry-button { flex-shrink: 0; margin: 0; background: #FFFEF9; color: #805710; }
.profile-card { padding: 28rpx; border-radius: 32rpx; background: #FFFEF9; box-shadow: 0 10rpx 30rpx rgba(163,122,37,.06); }
.field-label { display: block; font-size: 29rpx; line-height: 1.5; margin-bottom: 14rpx; }
.avatar-row { display: flex; align-items: center; gap: 24rpx; flex-wrap: wrap; }
.avatar { width: 144rpx; height: 144rpx; flex-shrink: 0; border-radius: 50%; background: #EEECE6; border: 1rpx solid #F2EBDC; box-sizing: border-box; }
.avatar-actions { display: flex; flex: 1 1 410rpx; min-width: 0; gap: 16rpx; }
.avatar-button { display: flex; align-items: center; justify-content: center; gap: 10rpx; flex: 1; min-width: 0; box-sizing: border-box; margin: 0; padding: 12rpx 8rpx; min-height: 72rpx; line-height: 1.4; border-radius: 16rpx; font-size: 25rpx; font-weight: 600; white-space: nowrap; }
.change-button { color: #79520A; background: #FFF1C2; }
.clear-button { color: #8B8377; border: 1rpx solid #E8DCC0; background: #FBF8EE; }
button::after { border: 0; }
button[disabled] { opacity: .55; }
.picture-icon { font-size: 32rpx; line-height: 1; }
.trash-icon { position: relative; width: 22rpx; height: 26rpx; box-sizing: border-box; border: 3rpx solid currentColor; border-top: 0; border-radius: 0 0 3rpx 3rpx; margin: 6rpx 3rpx 0; flex-shrink: 0; }
.trash-icon::before { content: ''; position: absolute; top: -5rpx; left: -5rpx; width: 26rpx; border-top: 3rpx solid currentColor; }
.trash-icon::after { content: ''; position: absolute; width: 8rpx; height: 4rpx; border: 3rpx solid currentColor; border-bottom: 0; left: 4rpx; top: -10rpx; }
.trash-icon view { width: 5rpx; height: 14rpx; margin: 5rpx auto 0; border-left: 2rpx solid currentColor; border-right: 2rpx solid currentColor; }
.avatar-hint { display: block; color: #A18140; font-size: 23rpx; line-height: 1.5; margin-top: 16rpx; }
.nickname-section { border-top: 1rpx solid #EEE3CC; margin-top: 30rpx; padding-top: 24rpx; }
.nickname-input { width: 100%; box-sizing: border-box; height: 88rpx; padding: 0 24rpx; border-radius: 20rpx; background: #FCF5DC; font-size: 30rpx; color: #422919; }
.nickname-placeholder { color: #A4957D; }
.save-button { width: 100%; box-sizing: border-box; height: 90rpx; display: flex; align-items: center; justify-content: center; margin: 28rpx 0 0; border-radius: 20rpx; padding: 12rpx; line-height: 1.4; color: #4C3007; font-size: 34rpx; font-weight: 800; background: linear-gradient(110deg,#FFD451,#FFE589,#FFD14B); }
.paw-decoration { position: relative; height: 320rpx; margin-top: 90rpx; pointer-events: none; overflow: hidden; }
.paw { position: absolute; width: 70rpx; height: 74rpx; color: #FFE496; opacity: .48; transform: rotate(-18deg); }
.paw-one { right: 46rpx; top: 65rpx; }
.paw-two { right: 188rpx; top: 156rpx; transform: rotate(12deg) scale(.8); }
.toe { position: absolute; width: 16rpx; height: 23rpx; border-radius: 50%; background: currentColor; }
.toe-a { left: 0; top: 22rpx; transform: rotate(-24deg); }.toe-b { left: 17rpx; top: 3rpx; }.toe-c { right: 17rpx; top: 3rpx; }.toe-d { right: 0; top: 22rpx; transform: rotate(24deg); }
.paw-pad { position: absolute; width: 43rpx; height: 35rpx; left: 14rpx; bottom: 1rpx; border-radius: 55% 55% 45% 45%; background: currentColor; }
@media screen and (max-width: 350px) { .avatar-actions { flex-basis: 100%; } .avatar-row { gap: 18rpx; } .paw-decoration { margin-top: 40rpx; height: 220rpx; } }
</style>
