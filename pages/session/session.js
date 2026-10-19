const store = require('../../utils/store')
const api = require('../../utils/api')
const time = require('../../utils/time')
const drawQrcode = require('../../utils/qrcode')

const ROTATE_INTERVAL = 60000

Page({
  data: {
    mode: 'form',
    creating: false,
    error: '',
    title: '',
    trainDate: '',
    weekday: '',
    lateMinutes: '10',

    sessionId: 0,
    session: { title: '', train_date: '', lateMinutesText: '' },
    qrText: '',
    qrSize: 240,
    countdown: 0,
    expired: false,
    rotating: false,
    signedCount: 0,
    totalCount: 0,
    unsignedCount: 0,
    recent: [],
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const today = time.ymd(new Date())
    this.setData({
      trainDate: today,
      weekday: time.weekday(new Date()),
      title: this.suggestTitle(),
      qrSize: Math.floor((info.windowWidth || 375) * 0.62),
    })
    if (options && options.id) {
      this.setData({ sessionId: Number(options.id), mode: 'qr' })
      wx.setNavigationBarTitle({ title: '签到二维码' })
      this.loadSession()
    } else {
      wx.setNavigationBarTitle({ title: '发起签到' })
    }
  },

  onUnload() {
    this.clearTimers()
  },

  onHide() {
    this.clearTimers()
  },

  onShow() {
    if (this.data.mode === 'qr' && this.data.sessionId) {
      this.startTimers()
      this.loadSession()
    }
  },

  suggestTitle() {
    const week = time.weekday(new Date())
    if (week === '周一' || week === '周三' || week === '周五') return week + '常规训练'
    if (week === '周日') return '周日升旗演练'
    return week + '加练'
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    const patch = {}
    patch[key] = e.detail.value
    this.setData(patch)
  },

  onDateChange(e) {
    this.setData({ trainDate: e.detail.value, weekday: time.weekday(e.detail.value) })
  },

  async onCreate() {
    if (this.data.creating) return
    const title = (this.data.title || '').trim()
    if (!title) {
      this.setData({ error: '请填写场次名称' })
      return
    }
    const late = Number(this.data.lateMinutes)
    if (!Number.isInteger(late) || late < 0 || late > 1440) {
      this.setData({ error: '迟到分钟数应为 0 到 1440 的整数' })
      return
    }
    await store.ready()
    if (!store.state.canManage || !store.activeCampusId()) {
      this.setData({ error: '请使用管理员身份并选择具体校区后发起签到' })
      return
    }
    this.setData({ creating: true, error: '' })
    try {
      const session = await api.createSession({
        title: title,
        trainDate: this.data.trainDate,
        lateMinutes: this.data.lateMinutes,
      })
      this.setData({
        sessionId: session.id,
        mode: 'qr',
        token: session.qr_token,
        tokenUpdatedAt: session.token_updated_at,
        qrText: api.qrPayload(session.id, session.qr_token),
        session: this.decorate(session),
      })
      wx.setNavigationBarTitle({ title: '签到二维码' })
      this.drawQr()
      this.startTimers()
      this.loadSession()
    } catch (e) {
      this.setData({ error: e.message || '发起签到失败' })
    } finally {
      this.setData({ creating: false })
    }
  },

  decorate(s) {
    const late = Number(s.late_minutes) || 0
    return Object.assign({}, s, {
      lateMinutesText: late > 0 ? late + ' 分钟内不算迟到' : '不判迟到',
    })
  },

  async loadSession() {
    try {
      await store.ready()
      if (!store.state.canManage) {
        this.clearTimers()
        wx.redirectTo({ url: '/pages/detail/detail?id=' + this.data.sessionId })
        return
      }
      const s = await api.fetchSession(this.data.sessionId)
      if (!s) {
        wx.showToast({ title: '场次不存在', icon: 'none' })
        return
      }
      this.setData({
        session: this.decorate(s),
        token: s.qr_token,
        tokenUpdatedAt: s.token_updated_at,
        qrText: api.qrPayload(s.id, s.qr_token),
      })
      if (s.status !== 'open') {
        this.clearTimers()
        this.setData({ qrText: '', expired: true, countdown: 0 })
        wx.redirectTo({ url: '/pages/detail/detail?id=' + s.id })
        return
      }
      this.drawQr()
      this.tick()
      await this.loadStats()
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  async loadStats() {
    const records = await api.listSessionRecords(this.data.sessionId)
    const members = await api.listMembers(this.data.session.campus_id)
    const activeCount = members.filter((m) => m.active !== false).length
    const recent = records.slice(-12).reverse()
    this.setData({
      signedCount: records.length,
      totalCount: activeCount,
      unsignedCount: Math.max(0, activeCount - records.length),
      recent: recent,
    })
  },

  drawQr() {
    if (!this.data.qrText) return
    const size = this.data.qrSize
    try {
      drawQrcode({
        width: size,
        height: size,
        canvasId: 'qrcode',
        text: this.data.qrText,
        typeNumber: -1,
        correctLevel: 2,
        background: '#ffffff',
        foreground: '#9e1f19',
      })
    } catch (e) {
      wx.showToast({ title: '二维码绘制失败', icon: 'none' })
    }
  },

  startTimers() {
    this.clearTimers()
    this._rotateTimer = setInterval(() => {
      this.rotate()
    }, ROTATE_INTERVAL)
    this._tickTimer = setInterval(() => {
      this.tick()
    }, 1000)
    this._pollTimer = setInterval(() => {
      this.loadStats().catch(() => {})
    }, 10000)
  },

  clearTimers() {
    if (this._rotateTimer) clearInterval(this._rotateTimer)
    if (this._tickTimer) clearInterval(this._tickTimer)
    if (this._pollTimer) clearInterval(this._pollTimer)
    this._rotateTimer = null
    this._tickTimer = null
    this._pollTimer = null
  },

  tick() {
    if (!this.data.tokenUpdatedAt) return
    const updated = time.toDate(this.data.tokenUpdatedAt).getTime()
    if (isNaN(updated)) return
    const left = Math.ceil((api.TOKEN_TTL_MS - (Date.now() - updated)) / 1000)
    this.setData({
      countdown: left > 0 ? left : 0,
      expired: left <= 0,
    })
  },

  async rotate() {
    if (this.data.rotating) return
    this.setData({ rotating: true })
    try {
      const s = await api.rotateToken(this.data.sessionId)
      this.setData({
        token: s.qr_token,
        tokenUpdatedAt: s.token_updated_at,
        qrText: api.qrPayload(s.id, s.qr_token),
      })
      this.drawQr()
      this.tick()
    } catch (e) {
      // 刷新失败时保留上一个二维码，等倒计时结束后页面会提示过期
    } finally {
      this.setData({ rotating: false })
    }
  },

  onRotate() {
    this.rotate()
  },

  goDetail() {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + this.data.sessionId })
  },

  onClose() {
    wx.showModal({
      title: '结束本场签到',
      content: '结束后队员将无法再扫码签到，未签到人员需要在名单里手动补签。',
      confirmText: '结束',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await api.closeSession(this.data.sessionId)
          this.clearTimers()
          this.setData({ qrText: '', expired: true, countdown: 0 })
          wx.showToast({ title: '已结束', icon: 'success' })
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/detail/detail?id=' + this.data.sessionId })
          }, 600)
        } catch (e) {
          wx.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
      },
    })
  },
})
