const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const path = require('path')
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} }
  let page
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, exports: module.exports, require: name => {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      return require(path.resolve(__dirname, '..', path.dirname(file), name))
    }, Date, Number, Promise, console, encodeURIComponent, decodeURIComponent,
    Page: value => { page = value }, ...globals,
  }, { filename: file })
  if (!page) return module.exports
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = patch => Object.assign(page.data, patch)
  return page
}
let passed = 0
async function check(name, fn) {
  await fn(); passed++; console.log('  ok - ' + name)
}
async function main() {
  const store = { state: { uid: 'u1', identity: { name: '队员' } }, activeCampusId: () => 2 }
  const api = load('utils/api.js', { './cloud': { cloud: {} }, './store': store })
  await check('二维码拒绝空令牌、负数、小数及多余参数', () => {
    assert(api.parseQr('GC|1|ABCDEFGH'))
    for (const text of ['GC|1|', 'GC|-1|ABCDEFGH', 'GC|1.5|ABCDEFGH', 'GC|1|ABCDEFGH&x=1']) assert.strictEqual(api.parseQr(text), null)
  })
  await check('未来时间及过期二维码无效', () => {
    assert.strictEqual(api.tokenFresh(new Date(Date.now() + 60000)), false)
    assert.strictEqual(api.tokenFresh(new Date(Date.now() - 130000)), false)
    assert(api.tokenFresh(new Date(Date.now() - 1000)))
  })
  await check('身份恢复异常后清空权限和旧登录态', async () => {
    const s = load('utils/store.js', { './cloud': { cloud: { auth: { getSession: async () => { throw Error('offline') } } } } })
    s.state.uid = 'old'; s.applyIdentity({ role: 'super_admin', campus_id: 2 })
    assert.strictEqual(await s.refresh(), null)
    assert.strictEqual(s.state.uid, null); assert.strictEqual(s.state.canManage, false)
  })
  await check('超管选择全部校区不会退回自身校区', () => {
    const s = load('utils/store.js', { './cloud': { cloud: {} } })
    s.applyIdentity({ role: 'super_admin', campus_id: 2 }); s.setViewCampus(null)
    s.applyIdentity({ role: 'super_admin', campus_id: 2 })
    assert.strictEqual(s.activeCampusId(), null)
  })
  await check('登录后回到扫码页面；拒绝任意跳转地址', () => {
    const calls = []
    const wx = { redirectTo: x => calls.push(x.url), switchTab: x => calls.push(x.url) }
    const p = load('pages/login/login.js', { '../../utils/store': store }, { wx })
    p.autoRestore = () => {}
    const target = '/pages/checkin/checkin?id=1&token=ABCDEFGH'
    p.onLoad({ next: encodeURIComponent(target) }); p.finishLogin(); assert.strictEqual(calls.pop(), target)
    p.onLoad({ next: 'https://example.com' }); p.finishLogin(); assert.strictEqual(calls.pop(), '/pages/index/index')
  })
  await check('上传期间结束签到时不写记录且解除提交状态', async () => {
    let inserted = 0, hidden = 0, fetched = 0
    const page = load('pages/checkin/checkin.js', {
      '../../utils/store': store,
      '../../utils/api': {
        fetchSession: async () => ({ id: 1, status: ++fetched === 1 ? 'open' : 'closed', qr_token: 'ABCDEFGH' }),
        fetchMyRecord: async () => null, tokenFresh: () => true,
        uploadPhoto: async () => 'photo-path', submitCheckin: async () => { inserted++ },
      },
    }, { wx: { showLoading() {}, hideLoading() { hidden++ } } })
    page.setData({ sessionId: 1, token: 'ABCDEFGH', stage: 'ready', photo: 'local' })
    await page.onSubmit()
    assert.strictEqual(inserted, 0); assert.strictEqual(page.data.stage, 'failed')
    assert.strictEqual(page.data.submitting, false); assert(hidden > 0)
  })
  await check('无二维码不得进入拍照签到', async () => {
    const p = load('pages/checkin/checkin.js', {
      '../../utils/store': store, '../../utils/api': { fetchSession: async () => ({ status: 'open' }) },
    }, { wx: {} })
    await p.verify(); assert.strictEqual(p.data.stage, 'failed')
  })
  await check('签到提交失败后重试复用照片，成功显示记录', async () => {
    let uploads = 0, inserts = 0
    const p = load('pages/checkin/checkin.js', {
      '../../utils/store': store,
      '../../utils/api': {
        fetchSession: async () => ({ id: 1, status: 'open', qr_token: 'ABCDEFGH', campus_id: 2 }),
        fetchMyRecord: async () => null, tokenFresh: () => true,
        uploadPhoto: async () => { uploads++; return 'uploaded' },
        submitCheckin: async input => {
          inserts++; assert.strictEqual(input.photoPath, 'uploaded'); assert.strictEqual(input.campusId, 2)
          if (inserts === 1) throw Error('网络中断')
          return { signed_at: new Date().toISOString(), status: 'normal' }
        }, statusText: () => '出勤',
      },
    }, { wx: { showLoading() {}, hideLoading() {} } })
    p.setData({ sessionId: 1, token: 'ABCDEFGH', stage: 'ready', photo: 'local' })
    await p.onSubmit(); assert.strictEqual(p.data.error, '网络中断')
    await p.onSubmit(); assert.strictEqual(p.data.stage, 'done')
    assert.strictEqual(uploads, 1); assert.strictEqual(inserts, 2)
  })
  await check('跨校区汇总和剪贴板仅统计本校区场次', () => {
    const exp = require('../utils/export')
    const members = [{ owner_id: 'u1', name: '甲', campus_id: 1 }, { owner_id: 'u2', name: '乙', campus_id: 2 }]
    const sessions = [{ id: 1, campus_id: 1, title: 'A', train_date: '2026-10-01' }, { id: 2, campus_id: 2, title: 'B', train_date: '2026-10-02' }]
    const records = [{ session_id: 1, subject_id: 'u1', status: 'normal' }]
    const csv = exp.buildSummary('队伍', '2026-10', sessions, members, records)
    assert(csv.includes('甲,,,出勤,—,1,1,0,0,0,0,100%'))
    assert.strictEqual(exp.toClipboardTable(sessions, members, records).split('\n').length, 3)
  })
  console.log('通过 ' + passed + ' 项回归测试')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
