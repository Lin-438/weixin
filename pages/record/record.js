const store = require('../../utils/store')
const api = require('../../utils/api')
const { applies } = require('../../utils/attendance')
const time = require('../../utils/time')

Page({
  data: {
    isCaptain: false,
    tab: 'sessions',
    sessions: [],
    myRecords: [],
  },

  onLoad() {
    this.setData({ isCaptain: store.state.isCaptain })
  },

  onShow() {
    this.bootstrap()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    await store.ready()
    if (!store.state.uid) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    if (!store.state.identity) {
      wx.redirectTo({ url: '/pages/login/login' })
      return
    }
    this.setData({
      isCaptain: store.state.isCaptain,
      tab: store.state.isCaptain ? this.data.tab : 'mine',
    })
    this.load()
  },

  async load() {
    wx.showLoading({ title: '加载中', mask: true })
    try {
      if (store.state.isCaptain) {
        const sessions = await api.listSessions(60)
        const ids = sessions.map((s) => s.id)
        const records = await api.listRecordsBySessions(ids)
        const members = await api.listMembers()
        const total = members.filter((m) => m.active !== false).length
        const stat = {}
        records.forEach((rec) => {
          if (!stat[rec.session_id]) {
            stat[rec.session_id] = { signed: 0, late: 0, makeup: 0, leave: 0 }
          }
          const s = stat[rec.session_id]
          s.signed += 1
          if (rec.status === 'late') s.late += 1
          if (rec.status === 'makeup') s.makeup += 1
          if (rec.status === 'leave') s.leave += 1
        })
        const list = sessions.map((s) => {
          const total = members.filter((m) => m.active !== false && applies(m, s)).length
          const st = stat[s.id] || { signed: 0, late: 0, makeup: 0, leave: 0 }
          return Object.assign({}, s, {
            statusText: s.status === 'open' ? '进行中' : '已结束',
            signedCount: st.signed,
            totalCount: total,
            lateCount: st.late,
            makeupCount: st.makeup,
            leaveCount: st.leave,
            percent: total === 0 ? 0 : Math.round((st.signed / total) * 100),
          })
        })
        this.setData({ sessions: list })
      }

      const myRecords = await api.listMyRecords(60)
      const allSessions = await api.listSessions(60)
      const titleMap = {}
      allSessions.forEach((s) => {
        titleMap[s.id] = s
      })
      this.setData({
        myRecords: myRecords.map((rec) => {
          const s = titleMap[rec.session_id]
          return Object.assign({}, rec, {
            sessionTitle: s ? s.title : '已删除的场次',
            trainDate: s ? s.train_date : '',
            timeText: time.mdHm(rec.signed_at),
            statusText: api.statusText(rec.status),
          })
        }),
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

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goStats() {
    wx.navigateTo({ url: '/pages/stats/stats' })
  },
})
