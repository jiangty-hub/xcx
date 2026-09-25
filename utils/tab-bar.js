// uni-app 页面显式更新它自己的微信原生 TabBar 实例。
export function syncTabBar(page, selected) {
  // #ifdef MP-WEIXIN
  const update = () => {
    const nativePage = page && (page.$scope || (page.$mp && page.$mp.page))
    if (!nativePage || typeof nativePage.getTabBar !== 'function') return
    const tabBar = nativePage.getTabBar()
    if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ selected })
  }
  update()
  // 首次 onShow 时原生组件可能尚未挂载；页面渲染后再同步。
  if (page && typeof page.$nextTick === 'function') page.$nextTick(update)
  // #endif
}
