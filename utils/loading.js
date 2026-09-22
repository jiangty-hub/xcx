// 所有手动加载框共享所有权，避免一个请求关闭另一个请求的加载框。
const tasks = new Set()
let closing = Promise.resolve()

export function beginLoading(title = '加载中...') {
  const task = {}
  tasks.add(task)
  try {
    uni.showLoading({
      title,
      mask: true,
      fail(error) {
        tasks.delete(task)
        console.warn('showLoading failed:', error)
      }
    })
  } catch (error) {
    tasks.delete(task)
    console.warn('showLoading failed:', error)
  }

  let stopped = false
  return function stopLoading() {
    if (stopped) return closing
    stopped = true
    if (!tasks.delete(task) || tasks.size) return closing
    closing = new Promise(resolve => {
      try {
        // 回调模式避免原生提示框已消失时产生未处理的 Promise 拒绝。
        uni.hideLoading({
          fail(error) {
            if (!/toast can't be found/.test(error?.errMsg || '')) {
              console.warn('hideLoading failed:', error)
            }
          },
          complete: resolve
        })
      } catch (error) {
        console.warn('hideLoading failed:', error)
        resolve()
      }
    })
    return closing
  }
}
