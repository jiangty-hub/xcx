import { createSSRApp } from 'vue'
import App from './App.vue'

export function createApp() {
  const app = createSSRApp(App)
  app.config.globalProperties.$showError = function (
      err,
      msg = '请求失败',
      duration = 1500
    ) {
      console.error(msg, err)
      uni.showToast({
        title: msg,
        icon: 'none',
        duration
      })
    }
  return {
    app
  }
}
