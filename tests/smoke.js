/**
 * 纯逻辑冒烟测试：出勤表导出与二维码载荷解析。
 * 运行：node tests/smoke.js
 */
const path = require('path')
const assert = require('assert')
const exp = require(path.join(__dirname, '..', 'utils', 'export.js'))
const time = require(path.join(__dirname, '..', 'utils', 'time.js'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok  - ' + name)
  } catch (e) {
    console.error('  FAIL- ' + name + '\n        ' + e.message)
    process.exitCode = 1
  }
}

console.log('[1] 时间格式化')
check('ymd 输出 YYYY-MM-DD', function () {
  assert.strictEqual(time.ymd(new Date(2026, 9, 18)), '2026-10-18')
})
check('mdHm 输出 MM-DD HH:mm', function () {
  assert.strictEqual(time.mdHm(new Date(2026, 9, 18, 9, 5)), '10-18 09:05')
})
check('解析 Postgres 时间戳', function () {
  assert.strictEqual(time.mdHm('2026-10-18 01:05:00+00'), '10-18 09:05')
})

console.log('[2] 月度汇总表')
const members = [
  { id: 1, owner_id: 'u1', name: '张仪', student_no: '20230101', squad: '一排', active: true },
  { id: 2, owner_id: 'u2', name: '李旗', student_no: '20230102', squad: '二排', active: true },
  { id: 3, owner_id: 'u3', name: '王已退', student_no: '20230103', squad: '一排', active: false },
]
const sessions = [
  { id: 11, title: '周一常规训练', train_date: '2026-10-05' },
  { id: 12, title: '周四升旗演练', train_date: '2026-10-08' },
]
const records = [
  { id: 101, session_id: 11, subject_id: 'u1', status: 'normal', signed_at: '2026-10-05 10:00:00+00' },
  { id: 102, session_id: 12, subject_id: 'u1', status: 'late', signed_at: '2026-10-08 10:20:00+00' },
  { id: 103, session_id: 11, subject_id: 'u2', status: 'leave', signed_at: '2026-10-05 10:00:00+00' },
]

check('汇总表含表头与两名在编队员', function () {
  const csv = exp.buildSummary('国旗护卫队', '2026-10', sessions, members, records)
  assert.ok(csv.indexOf('\uFEFF') === 0, '缺少 UTF-8 BOM')
  assert.ok(csv.indexOf('周一常规训练') > 0)
  assert.ok(csv.indexOf('张仪') > 0)
  assert.ok(csv.indexOf('王已退') === -1, '已停用队员不应出现')
})
check('出勤率按 (出勤+迟到+补签)/场次 计算', function () {
  const csv = exp.buildSummary('国旗护卫队', '2026-10', sessions, members, records)
  const line = csv.split('\r\n').find(function (l) {
    return l.indexOf('张仪') === 0 || l.indexOf('张仪,') === 0
  })
  assert.ok(line, '找不到张仪那一行：' + csv)
  assert.ok(line.indexOf('100%') > 0, '张仪两场都有记录，应为 100%：' + line)
  const leaveLine = csv.split('\r\n').find(function (l) {
    return l.indexOf('李旗,') === 0
  })
  assert.ok(leaveLine.indexOf('0%') > 0, '李旗一场请假一场缺勤，应为 0%：' + leaveLine)
})
check('缺勤单元格标记为缺勤', function () {
  const csv = exp.buildSummary('国旗护卫队', '2026-10', sessions, members, records)
  const line = csv.split('\r\n').find(function (l) {
    return l.indexOf('李旗,') === 0
  })
  const cells = line.split(',')
  assert.strictEqual(cells[3], '请假')
  assert.strictEqual(cells[4], '缺勤')
})

console.log('[3] 明细表与剪贴板')
check('明细表按记录条数输出', function () {
  const csv = exp.buildDetail('国旗护卫队', '2026-10', sessions, members, records)
  const body = csv.split('\r\n').filter(function (l) {
    return l.length > 0
  })
  // 2 行标题 + 1 表头 + 3 条记录（空行被过滤）
  assert.strictEqual(body.length, 6, '实际：' + body.length)
  assert.ok(csv.indexOf('10-05 18:00') > 0, '签到时间应为北京时间 18:00：' + csv)
})
check('剪贴板表格含表头与每人每场一行', function () {
  const text = exp.toClipboardTable(sessions, members, records)
  const lines = text.split('\n')
  assert.strictEqual(lines.length, 1 + 2 * 2, '实际：' + lines.length)
})

console.log('[4] CSV 转义')
check('含逗号与引号的字段被转义', function () {
  const csv = exp.buildSummary('国旗护卫队', '2026-10', [{ id: 1, title: '周六, "加练"', train_date: '2026-10-10' }], members, [])
  assert.ok(csv.indexOf('"10-10 周六, ""加练"""') > 0, '实际：' + csv)
})

console.log('\n通过 ' + passed + ' 项检查')
