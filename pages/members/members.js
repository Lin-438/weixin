const store = require('../../utils/store')
const api = require('../../utils/api')

Page({
  data: {
    members: [],
    activeCount: 0,
    inactiveCount: 0,
    campusName: '',
    keyword: '',
    canManage: false,
  },

  async onLoad() {
    await store.ready()
    if (!store.state.canManage) {
      wx.showToast({ title: '仅管理员可查看名册', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    this.setData({ canManage: true })
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async load() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      const members = await api.listMembers()
      const campusMap = {}
      ;(store.state.campuses || []).forEach(function (c) {
        campusMap[c.id] = c.name
      })
      const list = members.map(function (m) {
        return Object.assign({}, m, {
          campusName: campusMap[m.campus_id] || '',
          statusTag: m.active === false ? '已停用' : '',
        })
      })
      const active = list.filter((m) => m.active !== false).length
      this.setData({
        members: list,
        activeCount: active,
        inactiveCount: list.length - active,
        campusName: store.state.isSuper ? '全部校区' : store.state.identity.campus_name || '',
      })
      wx.hideLoading()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' })
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  onToggle(e) {
    const index = Number(e.currentTarget.dataset.index)
    const member = this.data.members[index]
    if (!member) return
    const next = member.active === false
    wx.showModal({
      title: next ? '启用 ' + member.name + '？' : '停用 ' + member.name + '？',
      content: next
        ? '启用后该队员会重新计入未签名单与出勤表。'
        : '停用后该队员不再计入未签名单与月度出勤表，并会解除微信绑定。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.setMemberActive(member.id, next)
          wx.showToast({ title: next ? '已启用' : '已停用', icon: 'success' })
          this.load()
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      },
    })
  },

  onResetPassword(e) {
    const index = Number(e.currentTarget.dataset.index)
    const member = this.data.members[index]
    if (!member) return
    wx.showModal({
      title: '重置 ' + member.name + ' 的密码？',
      content: '密码会恢复为学号 ' + (member.student_no || '') + '，并解除原微信绑定，需要重新绑定一次。',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.resetMemberPassword(member.id)
          wx.showToast({ title: '已重置为学号', icon: 'success' })
        } catch (err) {
          wx.showToast({ title: err.message || '重置失败', icon: 'none' })
        }
      },
    })
  },
})
