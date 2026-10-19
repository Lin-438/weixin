const store = require('../../utils/store')
const api = require('../../utils/api')
const exp = require('../../utils/export')
const { applies } = require('../../utils/attendance')
const time = require('../../utils/time')

Page({
  data: {
    month: '',
    hasData: false,
    overview: { sessionCount: 0, memberCount: 0, rate: '0%', absentCount: 0 },
    rows: [],
  },

  onLoad() {
    this.setData({ month: time.ym(new Date()) })
    this.load()
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value })
    this.load()
  },

  async load() {
    await store.ready()
    if (!store.state.canManage) {
      wx.showToast({ title: '仅管理员可查看统计', icon: 'none' })
      return
    }
    const request = this._request = (this._request || 0) + 1
    this._raw = null
    wx.showLoading({ title: '统计中', mask: true })
    try {
      const raw = await api.monthData(this.data.month)
      if (request !== this._request) return
      this._raw = raw
      const active = raw.members.filter((m) => m.active !== false)
      const bySession = {}
      raw.records.forEach((rec) => {
        if (!bySession[rec.session_id]) bySession[rec.session_id] = {}
        bySession[rec.session_id][rec.subject_id] = rec
      })

      let totalPresent = 0
      let totalAbsent = 0
      const rows = active.map((m) => {
        let normal = 0
        let late = 0
        let makeup = 0
        let leave = 0
        let absent = 0
        const relevant = raw.sessions.filter((s) => applies(m, s))
        relevant.forEach((s) => {
          const rec = m.owner_id && bySession[s.id] ? bySession[s.id][m.owner_id] : null
          const status = rec ? rec.status : 'absent'
          if (status === 'normal') normal += 1
          else if (status === 'late') late += 1
          else if (status === 'makeup') makeup += 1
          else if (status === 'leave') leave += 1
          else absent += 1
        })
        const present = normal + late + makeup
        totalPresent += present
        totalAbsent += absent
        const rate = relevant.length === 0 ? '0%' : Math.round((present / relevant.length) * 1000) / 10 + '%'
        return {
          owner_id: m.owner_id,
          name: m.name || '',
          squad: m.squad || '',
          normal: normal,
          late: late,
          makeup: makeup,
          leave: leave,
          absent: absent,
          rate: rate,
        }
      })

      const slots = active.reduce((n, m) => n + raw.sessions.filter((s) => applies(m, s)).length, 0)
      this.setData({
        hasData: raw.sessions.length > 0,
        rows: rows,
        overview: {
          sessionCount: raw.sessions.length,
          memberCount: active.length,
          rate: slots === 0 ? '0%' : Math.round((totalPresent / slots) * 1000) / 10 + '%',
          absentCount: totalAbsent,
        },
      })
      wx.hideLoading()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: e.message || '统计失败', icon: 'none' })
    }
  },

  rawData() {
    if (!this._raw) {
      wx.showToast({ title: '数据还在加载', icon: 'none' })
      return null
    }
    if (this._raw.sessions.length === 0) {
      wx.showToast({ title: this.data.month + ' 没有训练场次', icon: 'none' })
      return null
    }
    return this._raw
  },

  /** 同步写文件后立刻转发，避免异步打断用户手势 */
  shareCsv(label, csv) {
    const fs = wx.getFileSystemManager()
    const name = store.state.teamName + '_' + this.data.month + '_' + label + '.csv'
    const filePath = wx.env.USER_DATA_PATH + '/' + name
    try {
      fs.writeFileSync(filePath, csv, 'utf8')
    } catch (e) {
      wx.showToast({ title: '文件生成失败', icon: 'none' })
      return
    }
    if (typeof wx.shareFileMessage === 'function') {
      wx.shareFileMessage({
        filePath: filePath,
        success() {
          wx.showToast({ title: '已生成，可发送给好友', icon: 'none' })
        },
        fail() {
          wx.setClipboardData({ data: csv })
        },
      })
      return
    }
    wx.setClipboardData({ data: csv })
  },

  onExportSummary() {
    const raw = this.rawData()
    if (!raw) return
    const csv = exp.buildSummary(
      store.state.teamName,
      this.data.month,
      raw.sessions,
      raw.members,
      raw.records
    )
    this.shareCsv('出勤汇总表', csv)
  },

  onExportDetail() {
    const raw = this.rawData()
    if (!raw) return
    const csv = exp.buildDetail(
      store.state.teamName,
      this.data.month,
      raw.sessions,
      raw.members,
      raw.records
    )
    this.shareCsv('签到明细表', csv)
  },

  onCopy() {
    const raw = this.rawData()
    if (!raw) return
    const text = exp.toClipboardTable(raw.sessions, raw.members, raw.records)
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '已复制，可粘贴进 Excel', icon: 'none' })
      },
    })
  },
})
