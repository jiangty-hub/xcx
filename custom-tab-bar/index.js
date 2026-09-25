Component({
  data: {
    selected: 0,
    items: [
      { path: '/pages/home/home', text: '首页', icon: 'home' },
      { path: '/pages/category/category', text: '分类', icon: 'category' },
      { path: '/pages/my/my', text: '我的', icon: 'profile' }
    ]
  },
  lifetimes: { attached() { this.syncRoute() } },
  pageLifetimes: { show() { this.syncRoute() } },
  methods: {
    syncRoute() {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      const route = page && '/' + page.route
      const selected = this.data.items.findIndex(item => item.path === route)
      if (selected >= 0 && selected !== this.data.selected) this.setData({ selected })
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.items[index]
      if (!item || this.switching) return
      const pages = getCurrentPages()
      if (pages.length && '/' + pages[pages.length - 1].route === item.path) return
      this.switching = true
      wx.switchTab({
        url: item.path,
        fail: () => wx.showToast({ title: '切换失败，请重试', icon: 'none' }),
        complete: () => { this.switching = false; this.syncRoute() }
      })
    }
  }
})
