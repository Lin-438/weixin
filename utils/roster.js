const { pinyin } = require('./pinyin')
const JSZip = require('./jszip')

/** 姓名转拼音登录名：张伟 → zhangwei */
function pinyinOf(name) {
  const text = String(name || '').replace(/\s+/g, '')
  if (!text) return ''
  let arr = []
  try {
    arr = pinyin(text, { toneType: 'none', type: 'array', mode: 'surname' })
  } catch (e) {
    arr = null
  }
  if (!arr || !arr.length || arr.join('').indexOf(text) >= 0) {
    try {
      arr = pinyin(text, { toneType: 'none', type: 'array' })
    } catch (e) {
      arr = []
    }
  }
  const joined = (arr || []).join('')
  return joined.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, code) {
      return String.fromCharCode(Number(code))
    })
    .replace(/&amp;/g, '&')
}

function columnIndex(ref) {
  const m = /^([A-Z]+)/.exec(String(ref || ''))
  if (!m) return -1
  let n = 0
  for (let i = 0; i < m[1].length; i += 1) {
    n = n * 26 + (m[1].charCodeAt(i) - 64)
  }
  return n - 1
}

function parseSharedStrings(xml) {
  const out = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = re.exec(xml))) {
    const texts = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
    out.push(
      texts
        .map(function (t) {
          return decodeXml(t.replace(/<[^>]+>/g, ''))
        })
        .join('')
    )
  }
  return out
}

function parseSheetXml(xml, shared) {
  const rows = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = []
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g
    let cellMatch
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || cellMatch[2] || ''
      const inner = cellMatch[3] || ''
      const refMatch = /r="([A-Z]+\d+)"/.exec(attrs)
      const index = refMatch ? columnIndex(refMatch[1]) : cells.length
      const typeMatch = /t="([^"]+)"/.exec(attrs)
      let value = ''
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner)
      const inlineMatch = /<is>([\s\S]*?)<\/is>/.exec(inner)
      if (vMatch) {
        value = vMatch[1]
        if (typeMatch && typeMatch[1] === 's') {
          value = shared[Number(value)]
        }
      } else if (inlineMatch) {
        const texts = inlineMatch[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []
        value = texts
          .map(function (t) {
            return decodeXml(t.replace(/<[^>]+>/g, ''))
          })
          .join('')
      }
      cells[index] = decodeXml(value)
    }
    rows.push(cells)
  }
  return rows
}

/** 读取 xlsx：返回二维数组 */
async function readXlsxFile(filePath) {
  const buffer = await new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error(err.errMsg || '读取文件失败'))
      },
    })
  })
  const zip = new JSZip()
  await zip.loadAsync(buffer)
  const sharedFile = zip.file('xl/sharedStrings.xml')
  const shared = sharedFile ? parseSharedStrings(await sharedFile.async('string')) : []
  let sheetFile = zip.file('xl/worksheets/sheet1.xml')
  if (!sheetFile) {
    const names = Object.keys(zip.files).filter(function (n) {
      return /^xl\/worksheets\/sheet\d+\.xml$/.test(n)
    })
    if (names.length === 0) throw new Error('没有找到工作表内容')
    names.sort()
    sheetFile = zip.file(names[0])
  }
  const sheetXml = await sheetFile.async('string')
  return parseSheetXml(sheetXml, shared)
}

/** 读取 csv / txt：返回二维数组 */
async function readTextFile(filePath) {
  const text = await new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'utf8',
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error(err.errMsg || '读取文件失败'))
      },
    })
  })
  return parseTableText(text)
}

/** 解析粘贴的文本：支持制表符、逗号、连续空格分隔 */
function parseTableText(text) {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const rows = []
  lines.forEach(function (line) {
    const trimmed = line.trim()
    if (!trimmed) return
    let cells
    if (trimmed.indexOf('\t') >= 0) {
      cells = trimmed.split('\t')
    } else if (trimmed.indexOf(',') >= 0) {
      cells = trimmed.split(',')
    } else if (trimmed.indexOf('，') >= 0) {
      cells = trimmed.split('，')
    } else {
      cells = trimmed.split(/\s{2,}|\s+/)
    }
    rows.push(
      cells.map(function (c) {
        return String(c || '').trim()
      })
    )
  })
  return rows
}

function matchColumn(header, keywordList) {
  const text = String(header || '')
  for (let i = 0; i < keywordList.length; i += 1) {
    if (text.indexOf(keywordList[i]) >= 0) return true
  }
  return false
}

/** 把二维数组规整成 { name, student_no, squad, phone, login } */
function normalizeRows(rows) {
  if (!rows || rows.length === 0) return []
  let headerIndex = -1
  const first = rows[0]
  const looksLikeHeader = first.some(function (cell) {
    return matchColumn(cell, ['姓名', '名字', '学号', '队员', '分队', '电话'])
  })
  if (looksLikeHeader) headerIndex = 0

  let map = { name: 0, student_no: 1, squad: 2, phone: 3, login: -1 }
  if (headerIndex >= 0) {
    map = { name: -1, student_no: -1, squad: -1, phone: -1, login: -1 }
    first.forEach(function (cell, i) {
      if (map.login < 0 && matchColumn(cell, ['拼音', '账号', '登录名'])) map.login = i
      else if (map.name < 0 && matchColumn(cell, ['姓名', '名字', '队员'])) map.name = i
      else if (map.student_no < 0 && matchColumn(cell, ['学号', '编号', '学工号', '学籍号'])) map.student_no = i
      else if (map.squad < 0 && matchColumn(cell, ['分队', '队别', '班级', '部门'])) map.squad = i
      else if (map.phone < 0 && matchColumn(cell, ['电话', '手机', '联系方式'])) map.phone = i
    })
    if (map.name < 0) map.name = 0
    if (map.student_no < 0) map.student_no = 1
  }

  const out = []
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (!row) continue
    const name = String((row[map.name] === undefined ? '' : row[map.name]) || '').trim()
    const studentNo = String((row[map.student_no] === undefined ? '' : row[map.student_no]) || '').trim()
    if (!name && !studentNo) continue
    out.push({
      name: name,
      student_no: studentNo,
      squad: map.squad >= 0 ? String((row[map.squad] || '')).trim() : '',
      phone: map.phone >= 0 ? String((row[map.phone] || '')).trim() : '',
      login: map.login >= 0 ? String((row[map.login] || '')).trim() : '',
    })
  }
  return out
}

/** 给规整后的行补上拼音账号 */
function fillLoginNames(rows) {
  const used = {}
  return (rows || []).map(function (row) {
    let login = String(row.login || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!login) login = pinyinOf(row.name)
    if (!login) login = 'm' + String(row.student_no || '').replace(/[^0-9a-z]/gi, '')
    let final = login
    let n = 1
    while (used[final]) {
      n += 1
      final = login + n
    }
    used[final] = true
    return Object.assign({}, row, { login: final })
  })
}

module.exports = {
  pinyinOf: pinyinOf,
  readXlsxFile: readXlsxFile,
  readTextFile: readTextFile,
  parseTableText: parseTableText,
  normalizeRows: normalizeRows,
  fillLoginNames: fillLoginNames,
}
