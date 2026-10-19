const store = require('../../utils/store')
const api = require('../../utils/api')
const time = require('../../utils/time')

function ensureCamera() {
  return new Promise((resolve) => {
    wx.getSetting({
      success(setting) {
        const auth = setting.authSetting || {}
        if (auth['scope.camera'] === false) {
          wx.showModal({
            title: '需要相机权限',
            content: '训练签到必须现场拍照，请在设置中允许使用相机。',
            confirmText: '去设置',
            success(res) {
              if (res.confirm) wx.openSetting({})
            },
          })
          resolve(false)
          return
        }
        if (auth['scope.camera']) {
          resolve(true)
          return
        }
        wx.authorize({
          scope: 'scope.camera',
          success() {
            resolve(true)
          },
          fail() {
            resolve(false)
          },
        })
      },
      fail() {
        resolve(false)
      },
    })
  })
}

Page({
  data: {
    stage: 'loading',
    failReason: '',
    error: '',
    sessionId: 0,
    token: '',
    session: { title: '', train_date: '', owner_name: '' },
    profile: { name: '', student_no: '' },
    photo: '',
    nowText: '',
    lateHint: '',
    submitting: false,
    myRecord: null,
    result: null,
  },

  onLoad(options) {
    const sessionId = Number(options && options.id)
    this.setData({
      sessionId: sessionId,
      token: (options && options.token) || '',
      profile: store.state.identity || { name: '', student_no: '' },
      nowText: time.mdHm(new Date()),
    })
    wx.setNavigationBarTitle({ title: '训练签到' })
    this.verify()
  },

  async verify() {
    try {
      if (!store.state.uid) {
        await store.ready()
      }
      if (!store.state.uid) {
        wx.redirectTo({ url: '/pages/login/login?next=' + encodeURIComponent('/pages/checkin/checkin?id=' + this.data.sessionId + '&token=' + encodeURIComponent(this.data.token)) })
        return
      }
      if (!store.state.identity) {
        wx.redirectTo({ url: '/pages/login/login?next=' + encodeURIComponent('/pages/checkin/checkin?id=' + this.data.sessionId + '&token=' + encodeURIComponent(this.data.token)) })
        return
      }
      this.setData({ profile: store.state.identity })

      const session = await api.fetchSession(this.data.sessionId)
      if (!session) {
        this.fail('找不到这场签到，二维码可能已失效。')
        return
      }
      if (session.status !== 'open') {
        this.fail('本场签到已结束，请联系队长补签。')
        return
      }
      if (!this.data.token) {
        this.fail('请扫描队长提供的签到二维码。')
        return
      }
      if (this.data.token) {
        if (session.qr_token !== this.data.token) {
          this.fail('二维码已刷新，请扫描队长手机上最新的二维码。')
          return
        }
        if (!api.tokenFresh(session.token_updated_at)) {
          this.fail('二维码已过期，请让队长刷新后重新扫描。')
          return
        }
      }

      this.setData({ session: session })

      const mine = await api.fetchMyRecord(this.data.sessionId)
      if (mine) {
        this.setData({
          stage: 'signed',
          myRecord: Object.assign({}, mine, {
            signedText: time.full(mine.signed_at),
            statusText: api.statusText(mine.status),
          }),
        })
        return
      }

      const late = Number(session.late_minutes) || 0
      this.setData({
        stage: 'ready',
        lateHint: late > 0 ? '发起后 ' + late + ' 分钟内不算迟到' : '本场不判迟到',
      })
    } catch (e) {
      this.fail(e.message || '校验失败，请重试')
    }
  },

  fail(reason) {
    this.setData({ stage: 'failed', failReason: reason })
  },

  async onTakePhoto() {
    if (this.data.submitting) return
    const ok = await ensureCamera()
    if (!ok) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      sizeType: ['compressed'],
      success: (res) => {
        const files = res.tempFiles || []
        if (files.length > 0) {
          this._uploadedPhoto = null
          this.setData({ photo: files[0].tempFilePath, nowText: time.mdHm(new Date()) })
        }
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
        wx.showToast({ title: '拍照失败，请重试', icon: 'none' })
      },
    })
  },

  computeStatus() {
    const late = Number(this.data.session.late_minutes) || 0
    if (late <= 0) return 'normal'
    const created = time.toDate(this.data.session.created_at).getTime()
    if (isNaN(created)) return 'normal'
    return Date.now() - created > late * 60000 ? 'late' : 'normal'
  },

  async onSubmit() {
    if (this.data.submitting || this.data.stage !== 'ready') return
    if (!this.data.photo) {
      this.setData({ error: '请先现场拍照再提交' })
      return
    }
    this.setData({ submitting: true, error: '' })
    wx.showLoading({ title: '上传照片中', mask: true })
    try {
      await this.verify()
      if (this.data.stage !== 'ready') return
      const photoPath = this._uploadedPhoto || await api.uploadPhoto(this.data.photo)
      this._uploadedPhoto = photoPath
      // 上传过程中场次可能已结束或二维码已刷新，再检查一次。
      await this.verify()
      if (this.data.stage !== 'ready') return
      const record = await api.submitCheckin({
        sessionId: this.data.sessionId,
        subjectName: store.state.identity ? store.state.identity.name : '',
        campusId: this.data.session ? this.data.session.campus_id : null,
        photoPath: photoPath,
        status: this.computeStatus(),
        clientTime: Date.now(),
      })
      wx.hideLoading()
      this.setData({
        stage: 'done',
        result: Object.assign({}, record, {
          signedText: time.full(record.signed_at),
          statusText: api.statusText(record.status),
        }),
      })
    } catch (e) {
      wx.hideLoading()
      this.setData({ error: e.message || '签到失败，请重试' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },
})
