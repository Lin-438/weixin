/**
 * 工程结构校验：页面登记、JSON 合法性、WXML 标签配平、wx:for 必带 wx:key。
 * 运行：node tests/validate.js
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
let fail = 0

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function walk(dir, visit) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules') return
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(file, visit)
    else visit(file)
  })
}

console.log('[1] app.json')
const app = readJson(path.join(root, 'app.json'))
if (!app.ok) {
  console.error('  FAIL app.json 非法：' + app.error)
  fail += 1
} else {
  const value = app.value
  if (value.lazyCodeLoading !== 'requiredComponents') {
    console.error('  FAIL lazyCodeLoading 必须为 requiredComponents')
    fail += 1
  } else {
    console.log('  ok  - lazyCodeLoading')
  }
  value.pages.forEach(function (page) {
    ;['wxml', 'js'].forEach(function (ext) {
      if (!fs.existsSync(path.join(root, page + '.' + ext))) {
        console.error('  FAIL 缺少文件 ' + page + '.' + ext)
        fail += 1
      }
    })
  })
  console.log('  ok  - ' + value.pages.length + ' 个页面均已登记且文件齐全')

  fs.readdirSync(path.join(root, 'pages')).forEach(function (dir) {
    const page = 'pages/' + dir + '/' + dir
    if (value.pages.indexOf(page) < 0) {
      console.error('  FAIL pages/' + dir + ' 未登记到 app.json')
      fail += 1
    }
  })
  ;(value.tabBar ? value.tabBar.list : []).forEach(function (item) {
    if (value.pages.indexOf(item.pagePath) < 0) {
      console.error('  FAIL tabBar 页面未登记：' + item.pagePath)
      fail += 1
    }
  })
  console.log('  ok  - tabBar 页面均已登记')
}

console.log('[2] JSON 合法性')
let jsonCount = 0
walk(root, function (file) {
  if (!file.endsWith('.json')) return
  jsonCount += 1
  const parsed = readJson(file)
  if (!parsed.ok) {
    console.error('  FAIL ' + path.relative(root, file) + '：' + parsed.error)
    fail += 1
  }
})
console.log('  ok  - 校验了 ' + jsonCount + ' 个 JSON 文件')

console.log('[3] WXML 结构')
const VOID_TAGS = ['image', 'input', 'icon', 'import', 'include', 'wxs']
let wxmlCount = 0
walk(root, function (file) {
  if (!file.endsWith('.wxml')) return
  wxmlCount += 1
  const source = fs.readFileSync(file, 'utf8')
  const stack = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  let match
  while ((match = tagRe.exec(source))) {
    const closing = match[1] === '/'
    const tag = match[2]
    const selfClosed = match[4] === '/'
    if (selfClosed) continue
    if (!closing && VOID_TAGS.indexOf(tag) >= 0) continue
    if (!closing) {
      stack.push(tag)
    } else {
      const opened = stack.pop()
      if (opened !== tag) {
        console.error('  FAIL ' + path.relative(root, file) + ' 标签不匹配：</' + tag + '> 对应 <' + opened + '>')
        fail += 1
      }
    }
  }
  if (stack.length) {
    console.error('  FAIL ' + path.relative(root, file) + ' 未闭合：' + stack.join(','))
    fail += 1
  }

  const forRe = /<[a-zA-Z][\w-]*[^>]*wx:for=[^>]*>/g
  let forMatch
  while ((forMatch = forRe.exec(source))) {
    if (forMatch[0].indexOf('wx:key') < 0) {
      console.error('  FAIL ' + path.relative(root, file) + ' 的 wx:for 缺少 wx:key')
      fail += 1
    }
  }
})
console.log('  ok  - 校验了 ' + wxmlCount + ' 个 WXML 文件')

console.log('[4] JS 语法')
let jsCount = 0
walk(root, function (file) {
  if (!file.endsWith('.js')) return
  jsCount += 1
  try {
    new Function(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    console.error('  FAIL ' + path.relative(root, file) + '：' + e.message)
    fail += 1
  }
})
console.log('  ok  - 校验了 ' + jsCount + ' 个 JS 文件')

console.log('\n' + (fail === 0 ? '结构校验全部通过' : '发现 ' + fail + ' 个问题'))
process.exitCode = fail === 0 ? 0 : 1
