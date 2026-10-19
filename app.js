const store = require('./utils/store')

App({
  globalData: {
    safeBottom: 0,
  },
  onLaunch() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.globalData.safeBottom = info.safeArea
      ? Math.max(0, info.screenHeight - info.safeArea.bottom)
      : 0
    store.restore()
  },
})
