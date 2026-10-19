function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function toDate(input) {
  if (input instanceof Date) return input
  if (typeof input === 'number') return new Date(input)
  if (typeof input === 'string') {
    // Postgres 返回 '2026-10-18 12:00:00+00' 这类格式，iOS 无法直接解析，统一补成 ISO
    const normalized = input.replace(' ', 'T').replace(/\+(\d{2})$/, '+$1:00')
    return new Date(normalized)
  }
  return new Date(NaN)
}

function isValid(input) {
  const d = toDate(input)
  return !isNaN(d.getTime())
}

/** YYYY-MM-DD */
function ymd(input) {
  const d = toDate(input || Date.now())
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** YYYY-MM */
function ym(input) {
  const d = toDate(input || Date.now())
  return d.getFullYear() + '-' + pad(d.getMonth() + 1)
}

/** MM-DD HH:mm */
function mdHm(input) {
  if (!isValid(input)) return '--'
  const d = toDate(input)
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** YYYY-MM-DD HH:mm:ss */
function full(input) {
  if (!isValid(input)) return '--'
  const d = toDate(input)
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  )
}

/** HH:mm:ss */
function hms(input) {
  if (!isValid(input)) return '--'
  const d = toDate(input)
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

function weekday(input) {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[toDate(input || Date.now()).getDay()]
}

/** 当前时间的可读字符串，用于签到快照 */
function nowStamp() {
  return full(new Date())
}

module.exports = { pad, ymd, ym, mdHm, full, hms, weekday, nowStamp, toDate, isValid }
