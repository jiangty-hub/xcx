<script>
	import {
		applyNewToken,
		clearAuthStorage,
		getAuthToken,
		isAuthExpiredResult
	} from '@/utils/auth.js'
	import { FULL_REFRESH_AFTER, RESUME_REFRESH_AFTER } from '@/utils/resume-refresh.js'

	const BACKGROUND_AT_KEY = 'app_background_at'

	export default {
		globalData: {
			backgroundAt: 0,
			hasShown: false,
			resumeSeq: 0,
			resumeRefreshLevel: 0,
			resumeElapsed: 0,
			resumeWasColdStart: false,
			authRefreshTask: null
		},
		onLaunch: function() {
			console.warn('当前组件仅支持 uni_modules 目录结构 ，请升级 HBuilderX 到 3.1.0 版本以上！')
			console.log('App Launch')
			this.globalData.backgroundAt = Number(uni.getStorageSync(BACKGROUND_AT_KEY) || 0)
		},
		onShow: function() {
			console.log('App Show')
			const now = Date.now()
			const isColdStart = !this.globalData.hasShown
			const backgroundAt = Number(this.globalData.backgroundAt || 0)
			const elapsed = backgroundAt > 0 ? Math.max(0, now - backgroundAt) : 0

			this.globalData.hasShown = true
			this.globalData.backgroundAt = 0
			uni.removeStorageSync(BACKGROUND_AT_KEY)

			if (!backgroundAt) return

			const level = elapsed >= FULL_REFRESH_AFTER
				? 2
				: (elapsed >= RESUME_REFRESH_AFTER ? 1 : 0)

			this.globalData.resumeSeq += 1
			this.globalData.resumeRefreshLevel = level
			this.globalData.resumeElapsed = elapsed
			this.globalData.resumeWasColdStart = isColdStart

			if (level >= 2) {
				const task = this.validateStoredSession()
				this.globalData.authRefreshTask = task
				task.finally(() => {
					if (this.globalData.authRefreshTask === task) {
						this.globalData.authRefreshTask = null
					}
				})
			}
		},
		onHide: function() {
			console.log('App Hide')
			const backgroundAt = Date.now()
			this.globalData.backgroundAt = backgroundAt
			uni.setStorageSync(BACKGROUND_AT_KEY, backgroundAt)
		},
		methods: {
			async validateStoredSession() {
				const token = getAuthToken()
				if (!token) return { valid: false, missingToken: true }

				const expiredAt = Number(uni.getStorageSync('uni_id_token_expired') || 0)
				if (expiredAt > 0 && expiredAt <= Date.now()) {
					clearAuthStorage()
					return { valid: false, expired: true }
				}

				try {
					const res = await uniCloud.callFunction({
						name: 'get-user-profile',
						data: { token }
					})
					const result = res.result || {}
					applyNewToken(result)
					if (isAuthExpiredResult(result)) {
						clearAuthStorage()
						return { valid: false, expired: true, result }
					}
					return { valid: Number(result.code || 0) === 0, result }
				} catch (error) {
					console.log('resume auth validation failed:', error)
					return { valid: null, networkError: true, error }
				}
			}
		}
	}
</script>

<style lang="scss">
	/*每个页面公共css */
	@import '@/uni_modules/uni-scss/index.scss';
	/* #ifndef APP-NVUE */
	@import '@/static/customicons.css';
	// 设置整个项目的背景色
	page {
		background-color: #f5f5f5;
	}

	/* #endif */
	.example-info {
		font-size: 14px;
		color: #333;
		padding: 10px;
	}
</style>
