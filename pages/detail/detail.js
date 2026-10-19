const store = require('../../utils/store')
const api = require('../../utils/api')
const time = require('../../utils/time')

Page({
  data: {
    sessionId: 0,
    session: { title: '', train_date: '', statusText: '' },
    isCaptain: false,
    tab: 'signed',
    signedList: [],
    unsignedList: [],
    signedCount: 0,
    unsignedCount: 0,
    totalCount: 0,
  },

  onLoad(options) {
    this.setData({
      sessionId: Number(options && options.id),
      isCaptain: store.state.isCaptain,
    })
    wx.setNavigationBarTitle({ title: '签到名单' })
    this.load()
  },

  onShow() {
    if (this.data.sessionId) this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async load() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      await store.ready()
      if (!store.state.identity) {
        wx.hideLoading()
        wx.redirectTo({ url: '/pages/login/login' })
        return
      }
      const session = await api.fetchSession(this.data.sessionId)
      if (!session) {
        wx.hideLoading()
        wx.showToast({ title: '场次不存在', icon: 'none' })
        return
      }
      const records = await api.listSessionRecords(this.data.sessionId)
      const members = await api.listMembers(session.campus_id)
      const memberMap = {}
      members.forEach((m) => {
        memberMap[m.owner_id] = m
      })
      const active = members.filter((m) => m.active !== false)

      const signedList = records.map((rec) => {
        const m = memberMap[rec.subject_id] || {}
        return Object.assign({}, rec, {
          squad: m.squad || '',
          student_no: m.student_no || '',
          timeText: time.mdHm(rec.signed_at),
          statusText: api.statusText(rec.status),
        })
      })

      const signedIds = {}
      records.forEach((rec) => {
        signedIds[rec.subject_id] = true
      })
      const unsignedList = active.filter((m) => !signedIds[m.owner_id])

      this.setData({
        session: Object.assign({}, session, {
          statusText: session.status === 'open' ? '进行中' : '已结束',
        }),
        isCaptain: store.state.isCaptain,
        signedList: signedList,
        unsignedList: unsignedList,
        signedCount: signedList.length,
        unsignedCount: unsignedList.length,
        totalCount: active.length,
      })
      wx.hideLoading()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  async onViewPhoto(e) {
    const item = this.data.signedList[e.currentTarget.dataset.index]
    if (!item || !item.photo_path) {
      wx.showToast({ title: '该记录没有照片', icon: 'none' })
      return
    }
    wx.showLoading({ title: '加载照片', mask: true })
    try {
      const url = await api.signedUrl(item.photo_path)
      wx.hideLoading()
      wx.previewImage({ urls: [url], current: url })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '照片加载失败', icon: 'none' })
    }
  },

  async onMakeup(e) {
    const member = this.data.unsignedList[e.currentTarget.dataset.index]
    await this.createFor(member, 'makeup', '补签')
  },

  async onLeave(e) {
    const member = this.data.unsignedList[e.currentTarget.dataset.index]
    await this.createFor(member, 'leave', '请假')
  },

  async createFor(member, status, label) {
    if (!member || !store.state.canManage) return
    if (!member.owner_id) {
      wx.showToast({ title: '该队员尚未绑定微信，暂不能补签', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认为' + member.name + label + '？',
      content: label + '记录会写入 ' + this.data.session.train_date + ' 的出勤表。',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '提交中', mask: true })
        try {
          await api.makeup({
            sessionId: this.data.sessionId,
            subjectId: member.owner_id,
            subjectName: member.name,
            campusId: this.data.session.campus_id,
            status: status,
            remark: label,
          })
          wx.hideLoading()
          wx.showToast({ title: '已' + label, icon: 'success' })
          this.load()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      },
    })
  },

  onRemove(e) {
    if (!store.state.canManage) return
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤销这条签到记录？',
      content: '撤销后该队员会回到未签名单。',
      confirmText: '撤销',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        try {
          await api.removeRecord(id)
          wx.hideLoading()
          wx.showToast({ title: '已撤销', icon: 'success' })
          this.load()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      },
    })
  },
})
