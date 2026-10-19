const store = require('../../utils/store')
const api = require('../../utils/api')
const time = require('../../utils/time')

function greetingText() {
  const h = new Date().getHours()
  if (h < 6) return '凌晨好'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

Page({
  data: {
    teamName: '国旗护卫队',
    greeting: '你好',
    canManage: false,
    isSuper: false,
    roleText: '队员',
    campusName: '',
    campusOptions: [],
    campusIndex: 0,
    identity: {},
    openSessions: [],
    myRecords: [],
    loading: false,
  },

  onLoad() {
    this.setData({ greeting: greetingText() })
  },

  onShow() {
    this.bootstrap(true)
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  async bootstrap(force) {
    if (this._busy) return
    this._busy = true
    try {
      if (force) await store.refresh()
      else await store.ready()
      if (!store.state.uid || !store.state.identity) {
        wx.redirectTo({ url: '/pages/login/login' })
        return
      }
      const campuses = store.state.campuses || []
      let options = []
      let activeId = store.activeCampusId()
      if (store.state.isSuper) {
        options = [{ id: 0, name: '全部校区' }].concat(
          campuses.map(function (c) {
            return { id: c.id, name: c.name }
          })
        )
      }
      let campusName = store.state.identity.campus_name || ''
      if (store.state.isSuper) {
        if (!activeId) {
          campusName = '全部校区'
        } else {
          const hit = campuses.filter(function (c) {
            return c.id === activeId
          })[0]
          campusName = hit ? hit.name : ''
        }
      }
      let campusIndex = 0
      options.forEach(function (opt, i) {
        if (opt.id === (activeId || 0)) campusIndex = i
      })

      this.setData({
        teamName: store.state.teamName,
        canManage: store.state.canManage,
        isSuper: store.state.isSuper,
        roleText: store.state.roleText,
        identity: store.state.identity,
        campusName: campusName,
        campusOptions: options,
        campusIndex: campusIndex,
      })
      await this.loadData()
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this._busy = false
    }
  },

  onCampusChange(e) {
    const index = Number(e.detail.value)
    const opt = this.data.campusOptions[index]
    if (!opt) return
    store.setViewCampus(opt.id || null)
    this.bootstrap(true)
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const sessions = await api.listOpenSessions()
      const ids = sessions.map((s) => s.id)
      const records = await api.listRecordsBySessions(ids)
      const countMap = {}
      const mineMap = {}
      records.forEach((rec) => {
        countMap[rec.session_id] = (countMap[rec.session_id] || 0) + 1
        if (rec.subject_id === store.state.uid) mineMap[rec.session_id] = rec
      })
      const campusMap = {}
      ;(store.state.campuses || []).forEach(function (c) {
        campusMap[c.id] = c.name
      })
      const openSessions = sessions.map((s) => {
        const mine = mineMap[s.id]
        return Object.assign({}, s, {
          signedCount: countMap[s.id] || 0,
          myStatus: mine ? mine.status : 'none',
          myStatusText: mine ? api.statusText(mine.status) : '未签到',
          campusName: campusMap[s.campus_id] || '',
        })
      })

      const myRecords = await api.listMyRecords(10)
      const allSessions = await api.listSessions(50)
      const titleMap = {}
      allSessions.forEach((s) => {
        titleMap[s.id] = s
      })
      const myList = myRecords.map((rec) => {
        const s = titleMap[rec.session_id]
        return Object.assign({}, rec, {
          sessionTitle: s ? s.title : '已删除的场次',
          trainDate: s ? s.train_date : '',
          timeText: time.mdHm(rec.signed_at),
          statusText: api.statusText(rec.status),
        })
      })

      this.setData({ openSessions: openSessions, myRecords: myList })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/session/session' })
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

  onTapSession(e) {
    const id = e.currentTarget.dataset.id
    if (store.state.canManage) {
      wx.navigateTo({ url: '/pages/session/session?id=' + id })
    } else {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
    }
  },

  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const parsed = api.parseQr(res.result)
        if (!parsed) {
          wx.showToast({ title: '这不是有效的签到二维码', icon: 'none' })
          return
        }
        wx.navigateTo({
          url: '/pages/checkin/checkin?id=' + parsed.sessionId + '&token=' + parsed.token,
        })
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
      },
    })
  },
})
