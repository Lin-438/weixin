const store = require('../../utils/store')
const api = require('../../utils/api')
const roster = require('../../utils/roster')

const SAMPLE = '张伟\t2023010101\t一分队\t13800000001\n李娜\t2023010102\t一分队\t13800000002'

Page({
  data: {
    campusId: null,
    campusOptions: [],
    campusIndex: 0,
    canSwitch: false,
    text: '',
    rows: [],
    total: 0,
    submitting: false,
    result: null,
    error: '',
    sample: SAMPLE,
  },

  async onLoad() {
    await store.ready()
    if (!store.state.canManage) {
      wx.showToast({ title: '仅管理员可导入名单', icon: 'none' })
      return
    }
    const campuses = store.state.campuses || []
    const isSuper = store.state.isSuper
    const options = campuses.map(function (c) {
      return { id: c.id, name: c.name }
    })
    let index = 0
    let campusId = store.activeCampusId()
    if (isSuper && !campusId && options.length > 0) campusId = options[0].id
    options.forEach(function (opt, i) {
      if (opt.id === campusId) index = i
    })
    this.setData({
      campusOptions: options,
      campusIndex: index,
      campusId: campusId,
      canSwitch: isSuper,
    })
  },

  onCampusChange(e) {
    const index = Number(e.detail.value)
    const opt = this.data.campusOptions[index]
    if (!opt) return
    this.setData({ campusIndex: index, campusId: opt.id })
  },

  onTextInput(e) {
    this.setData({ text: e.detail.value })
  },

  buildPreview(rows) {
    const normalized = roster.fillLoginNames(roster.normalizeRows(rows))
    this.setData({
      rows: normalized,
      total: normalized.length,
      error: normalized.length ? '' : '没有识别到有效名单，请检查格式',
    })
  },

  onParseText() {
    const text = this.data.text
    if (!String(text || '').trim()) {
      this.setData({ error: '请先粘贴名单内容' })
      return
    }
    this.buildPreview(roster.parseTableText(text))
  },

  onChooseFile() {
    const self = this
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'csv', 'txt'],
      success(res) {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        const name = String(file.name || '').toLowerCase()
        wx.showLoading({ title: '解析中' })
        const task =
          name.indexOf('.xlsx') >= 0
            ? roster.readXlsxFile(file.path)
            : roster.readTextFile(file.path)
        task
          .then(function (rows) {
            wx.hideLoading()
            self.buildPreview(rows)
          })
          .catch(function (err) {
            wx.hideLoading()
            self.setData({ error: err.message || '文件解析失败，请另存为 CSV 后重试' })
          })
      },
      fail(err) {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        wx.showToast({ title: '选择文件失败', icon: 'none' })
      },
    })
  },

  onClear() {
    this.setData({ rows: [], total: 0, text: '', error: '', result: null })
  },

  onRemoveRow(e) {
    const index = Number(e.currentTarget.dataset.index)
    const rows = this.data.rows.slice()
    rows.splice(index, 1)
    this.setData({ rows: rows, total: rows.length })
  },

  async onSubmit() {
    if (this.data.submitting) return
    if (!store.state.canManage) {
      this.setData({ error: '仅管理员可导入名单' })
      return
    }
    const rows = this.data.rows || []
    if (rows.length === 0) {
      this.setData({ error: '还没有可导入的名单' })
      return
    }
    if (!this.data.campusId) {
      this.setData({ error: '请选择要导入的校区' })
      return
    }
    this.setData({ submitting: true, error: '' })
    wx.showLoading({ title: '导入中' })
    try {
      const result = await api.importMembers(this.data.campusId, rows)
      wx.hideLoading()
      this.setData({ result: result })
      wx.showModal({
        title: '导入完成',
        content:
          '新增 ' +
          result.inserted +
          ' 人，更新 ' +
          result.updated +
          ' 人，跳过 ' +
          result.skipped +
          ' 人。初始密码为本人学号。',
        showCancel: false,
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({ error: e.message || '导入失败' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  onCopySample() {
    wx.setClipboardData({ data: SAMPLE })
  },
})
