const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    identity: {},
    roleText: '队员',
    canManage: false,
    isSuper: false,
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
    changing: false,
    pwdError: '',
    adminList: [],
  },

  onShow() {
    this.bootstrap()
  },

  async bootstrap() {
    await store.refresh()
    if (!store.state.uid || !store.state.identity) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.setData({
      identity: store.state.identity,
      roleText: store.state.roleText,
      canManage: store.state.canManage,
      isSuper: store.state.isSuper,
    })
    if (store.state.isSuper) this.loadAdmins()
  },

  async loadAdmins() {
    try {
      const admins = await api.listAdmins()
      const campusMap = {}
      ;(store.state.campuses || []).forEach(function (c) {
        campusMap[c.id] = c.name
      })
      this.setData({
        adminList: (admins || []).map(function (a) {
          return Object.assign({}, a, {
            campusName: a.campus_id ? campusMap[a.campus_id] || '' : '全部校区',
            boundText: a.owner_id ? '已绑定' : '未绑定',
          })
        }),
      })
    } catch (e) {
      // 管理账号总览失败不影响其他功能
    }
  },

  onOldInput(e) {
    this.setData({ oldPassword: e.detail.value, pwdError: '' })
  },

  onNewInput(e) {
    this.setData({ newPassword: e.detail.value, pwdError: '' })
  },

  onConfirmInput(e) {
    this.setData({ confirmPassword: e.detail.value, pwdError: '' })
  },

  async onChangePassword() {
    if (this.data.changing) return
    const oldPwd = String(this.data.oldPassword || '')
    const newPwd = String(this.data.newPassword || '')
    const confirm = String(this.data.confirmPassword || '')
    if (!oldPwd || !newPwd) {
      this.setData({ pwdError: '请填写原密码与新密码' })
      return
    }
    if (newPwd.length < 4) {
      this.setData({ pwdError: '新密码至少 4 位' })
      return
    }
    if (newPwd !== confirm) {
      this.setData({ pwdError: '两次输入的新密码不一致' })
      return
    }
    this.setData({ changing: true, pwdError: '' })
    try {
      await api.changeMyPassword(oldPwd, newPwd)
      wx.showToast({ title: '密码已修改', icon: 'success' })
      this.setData({ oldPassword: '', newPassword: '', confirmPassword: '' })
    } catch (e) {
      this.setData({ pwdError: e.message || '修改失败' })
    } finally {
      this.setData({ changing: false })
    }
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' })
  },

  goMembers() {
    wx.navigateTo({ url: '/pages/members/members' })
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新微信登录，已绑定的身份会保留。',
      confirmText: '退出',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await store.signOut()
          wx.redirectTo({ url: '/pages/login/login' })
        } catch (e) {
          wx.showToast({ title: '退出失败，请重试', icon: 'none' })
        }
      },
    })
  },
})
