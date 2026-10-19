const store = require('../../utils/store')

Page({
  data: {
    stage: 'start', // start | bind | done
    loading: false,
    binding: false,
    error: '',
    teamName: '国旗护卫队',
    login: '',
    password: '',
    hello: '',
  },

  onLoad(options) {
    let next = ''
    try { next = decodeURIComponent((options && options.next) || '') } catch (e) {}
    this._next = /^\/pages\/checkin\/checkin\?id=\d+&token=[A-HJ-NP-Z2-9]{8}$/.test(next) ? next : ''
    this.setData({ teamName: store.state.teamName || '国旗护卫队' })
    this.autoRestore()
  },

  async autoRestore() {
    try {
      await store.ready()
      if (!store.state.uid) return
      if (store.state.identity) {
        this.finishLogin()
        return
      }
      this.setData({ stage: 'bind' })
    } catch (e) {
      // 保持初始状态，由用户点按钮登录
    }
  },

  async onLogin() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const result = await store.signInWithWechat()
      if (result && result.identity) {
        wx.showToast({ title: '登录成功', icon: 'success' })
        this.finishLogin()
        return
      }
      this.setData({ stage: 'bind' })
    } catch (e) {
      console.error(
        '[WorkBuddy Cloud] login failed',
        JSON.stringify({ stage: 'wechat-login-handler', message: e.message })
      )
      this.setData({ error: e.message || '微信登录失败，请重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onInputLogin(e) {
    this.setData({ login: e.detail.value })
  },

  onInputPassword(e) {
    this.setData({ password: e.detail.value })
  },

  async onBind() {
    if (this.data.binding) return
    const login = String(this.data.login || '').trim()
    const password = String(this.data.password || '')
    if (!login) {
      this.setData({ error: '请输入姓名拼音' })
      return
    }
    if (!password) {
      this.setData({ error: '请输入密码（初始为学号）' })
      return
    }
    this.setData({ binding: true, error: '' })
    try {
      const row = await store.bindIdentity(login, password)
      wx.showToast({ title: '绑定成功', icon: 'success' })
      this.setData({ hello: row.name || '', stage: 'done' })
      this.finishLogin()
    } catch (e) {
      this.setData({ error: e.message || '绑定失败' })
    } finally {
      this.setData({ binding: false })
    }
  },

  finishLogin() {
    if (this._next) wx.redirectTo({ url: this._next })
    else wx.switchTab({ url: '/pages/index/index' })
  },

  onSkip() {
    this.finishLogin()
  },
})
