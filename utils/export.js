/**
 * 出勤表导出：纯计算模块，不依赖 wx，可在 Node 下直接做冒烟测试。
 */
const STATUS_TEXT = {
  normal: '出勤',
  late: '迟到',
  leave: '请假',
  makeup: '补签',
  absent: '缺勤',
}

const { applies } = require('./attendance')

const BOM = '\uFEFF'

function statusText(status) {
  return STATUS_TEXT[status] || status || '--'
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return text
}

function joinRow(cells) {
  return cells.map(escapeCsv).join(',')
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function hm(iso) {
  if (!iso) return ''
  const text = String(iso).replace(' ', 'T').replace(/\+(\d{2})$/, '+$1:00')
  const d = new Date(text)
  if (isNaN(d.getTime())) return ''
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function md(iso) {
  if (!iso) return ''
  const text = String(iso).replace(' ', 'T').replace(/\+(\d{2})$/, '+$1:00')
  const d = new Date(text)
  if (isNaN(d.getTime())) return ''
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/**
 * 把某场次的记录按队员归档。
 * @returns {Object} key = subject_id, value = record
 */
function indexRecords(records, sessionId) {
  const map = {}
  records.forEach(function (rec) {
    if (rec.session_id === sessionId) map[rec.subject_id] = rec
  })
  return map
}

/**
 * 月度出勤汇总表：一人一行，先按场次展开，再给出勤统计。
 */
function buildSummary(teamName, yearMonth, sessions, members, records) {
  const rosters = members.filter(function (m) {
    return m.active !== false
  })
  const perSession = sessions.map(function (s) {
    return indexRecords(records, s.id)
  })

  const header = ['姓名', '学号', '分队']
  sessions.forEach(function (s) {
    header.push(md(s.train_date) + ' ' + s.title)
  })
  header.push('应到场次', '出勤', '迟到', '补签', '请假', '缺勤', '出勤率')

  const rows = rosters.map(function (m) {
    let normal = 0
    let late = 0
    let makeup = 0
    let leave = 0
    let absent = 0
    const cells = [m.name || '', m.student_no || '', m.squad || '']

    sessions.forEach(function (s, i) {
      if (!applies(m, s)) { cells.push('—'); return }
      const rec = m.owner_id ? perSession[i][m.owner_id] : null
      const status = rec ? rec.status : 'absent'
      if (status === 'normal') normal += 1
      else if (status === 'late') late += 1
      else if (status === 'makeup') makeup += 1
      else if (status === 'leave') leave += 1
      else absent += 1
      cells.push(statusText(status))
    })

    const total = sessions.filter(function (s) { return applies(m, s) }).length
    const present = normal + late + makeup
    const rate = total === 0 ? '0%' : Math.round((present / total) * 1000) / 10 + '%'
    cells.push(total, normal, late, makeup, leave, absent, rate)
    return cells
  })

  const lines = []
  lines.push(joinRow([teamName + ' ' + yearMonth + ' 训练出勤汇总表']))
  lines.push(joinRow(['统计生成时间', new Date().toLocaleString('zh-CN')]))
  lines.push('')
  lines.push(joinRow(header))
  rows.forEach(function (r) {
    lines.push(joinRow(r))
  })
  return BOM + lines.join('\r\n')
}

/**
 * 月度签到明细表：一条记录一行，便于逐条核对照片与时间戳。
 */
function buildDetail(teamName, yearMonth, sessions, members, records) {
  const nameMap = {}
  members.forEach(function (m) {
    nameMap[m.owner_id] = m
  })
  const sessionMap = {}
  sessions.forEach(function (s) {
    sessionMap[s.id] = s
  })

  const header = ['日期', '场次', '姓名', '学号', '分队', '状态', '签到时间', '记录方式', '备注']
  const sorted = records.slice().sort(function (a, b) {
    const sa = sessionMap[a.session_id]
    const sb = sessionMap[b.session_id]
    const da = sa ? sa.train_date : ''
    const db = sb ? sb.train_date : ''
    if (da !== db) return da < db ? -1 : 1
    return String(a.signed_at) < String(b.signed_at) ? -1 : 1
  })

  const rows = sorted.map(function (rec) {
    const s = sessionMap[rec.session_id]
    const m = nameMap[rec.subject_id] || {}
    const way = rec.makeup_by ? '队长补签' : '扫码签到'
    return [
      s ? s.train_date : '',
      s ? s.title : '',
      rec.subject_name || m.name || '',
      m.student_no || '',
      m.squad || '',
      statusText(rec.status),
      (s ? s.train_date + ' ' : '') + hm(rec.signed_at),
      way,
      rec.remark || '',
    ]
  })

  const lines = []
  lines.push(joinRow([teamName + ' ' + yearMonth + ' 训练签到明细表']))
  lines.push(joinRow(['共 ' + rows.length + ' 条记录']))
  lines.push('')
  lines.push(joinRow(header))
  rows.forEach(function (r) {
    lines.push(joinRow(r))
  })
  return BOM + lines.join('\r\n')
}

/** 剪贴板用的制表符文本，可直接粘贴进 Excel */
function toClipboardTable(sessions, members, records) {
  const nameMap = {}
  members.forEach(function (m) {
    nameMap[m.owner_id] = m
  })
  const lines = ['姓名\t学号\t分队\t日期\t场次\t状态\t签到时间']
  sessions.forEach(function (s) {
    members.forEach(function (m) {
      if (m.active === false || !applies(m, s)) return
      const rec = records.find(function (r) {
        return m.owner_id && r.session_id === s.id && r.subject_id === m.owner_id
      })
      lines.push([
        m.name || '',
        m.student_no || '',
        m.squad || '',
        s.train_date,
        s.title,
        statusText(rec ? rec.status : 'absent'),
        rec ? hm(rec.signed_at) : '',
      ].join('\t'))
    })
  })
  return lines.join('\n')
}

module.exports = {
  BOM,
  STATUS_TEXT,
  statusText,
  escapeCsv,
  buildSummary,
  buildDetail,
  toClipboardTable,
  indexRecords,
}
