
// #ifndef VUE3
//封装弹框的方法
function showRequestError(err, msg = '请求失败，请稍后重试', duration = 1500) {
  console.error(msg, err)
  uni.showToast({
    title: msg,
    icon: 'none',
    duration
  })
}
import Vue from 'vue'
import App from './App'

// 挂到 Vue 实例
Vue.prototype.$showError = showRequestError
//导入网络请求的包
import { $http } from '@escook/request-miniprogram'

uni.$http = $http

//请求拦截器
$http.beforeRequest = function(options) {
	uni.showLoading({
		title:'我需要食物...'
	})
}
//响应拦截器
$http.afterRequest = function() {
	uni.hideLoading()
}

Vue.config.productionTip = false

App.mpType = 'app'

const app = new Vue({
    ...App
})
app.$mount()
// #endif

// #ifdef VUE3
import { createSSRApp } from 'vue'
import App from './App.vue'
export function createApp() {
  const app = createSSRApp(App)
  return {
    app
  }
}
// #endif