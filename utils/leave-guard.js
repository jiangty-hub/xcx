// 微信端不触发 onBackPress，使用页面级原生离开提醒。
// 串行切换开关，确保保存成功时的关闭不会被较早的开启请求覆盖。
const states = new WeakMap()

function nativeApi() {
  // #ifdef MP-WEIXIN
  if (typeof wx !== 'undefined' && typeof wx.enableAlertBeforeUnload === 'function' &&
      typeof wx.disableAlertBeforeUnload === 'function') return wx
  // #endif
  return null
}

export default {
  data() {
    return { leaveGuardLeaving: false }
  },
  watch: {
    leaveGuardMessage: {
      flush: 'sync',
      handler() { this.syncLeaveGuard() }
    }
  },
  onReady() {
    states.set(this, { active: true, disposed: false, applied: '', pending: Promise.resolve() })
    this.syncLeaveGuard()
  },
  onShow() {
    const state = states.get(this)
    if (state) {
      state.active = true
      this.syncLeaveGuard()
    }
  },
  onHide() {
    const state = states.get(this)
    if (state) state.active = false
  },
  onUnload() {
    const state = states.get(this)
    if (state) state.disposed = true
    // 页面级提醒随页面销毁；不在卸载后调用原生 API，避免影响返回后的页面。
    // WeakMap 不阻止页面回收，保留 disposed 标记以拦住迟到的返回任务。
  },
  methods: {
    syncLeaveGuard() {
      const state = states.get(this)
      const api = nativeApi()
      if (!state || !api) return Promise.resolve()
      state.pending = state.pending.then(() => {
        if (state.disposed || !state.active) return
        const message = this.leaveGuardLeaving ? '' : (this.leaveGuardMessage || '')
        if (message === state.applied) return
        return new Promise(resolve => {
          const options = {
            success: () => { state.applied = message },
            fail: error => { console.warn('页面离开提醒设置失败:', error) },
            complete: resolve
          }
          try {
            if (message) api.enableAlertBeforeUnload({ ...options, message })
            else api.disableAlertBeforeUnload(options)
          } catch (error) {
            console.warn('页面离开提醒设置失败:', error)
            resolve()
          }
        })
      })
      return state.pending
    },
    async preparePageLeave() {
      this.leaveGuardLeaving = true
      await this.syncLeaveGuard()
    },
    async leavePageWithoutAlert(options = {}) {
      await this.preparePageLeave()
      const state = states.get(this)
      if (state?.disposed || (state && !state.active)) return
      uni.navigateBack({
        ...options,
        fail: error => {
          this.leaveGuardLeaving = false
          this.syncLeaveGuard()
          if (options.fail) options.fail(error)
          else uni.showToast({ title: '返回失败，请重试', icon: 'none' })
        }
      })
    }
  }
}

