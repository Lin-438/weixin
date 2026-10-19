const { cloud } = require('./cloud')

const MANAGE_ROLES = ['super_admin', 'campus_admin', 'captain']

const state = {
  uid: null,
  user: null,
  identity: null,
  profile: null,
  role: 'guest',
  roleText: '未登录',
  canManage: false,
  isSuper: false,
  campusId: null,
  viewCampusId: null,
  campuses: [],
  teamName: '国旗护卫队',
  ready: false,
}

const ROLE_TEXT = {
  super_admin: '超级管理员',
  campus_admin: '校区管理员',
  captain: '队长',
  member: '队员',
  guest: '未绑定',
}

let pending = null

function applyIdentity(row) {
  const ok = !!(row && row.ok !== false)
  state.identity = ok ? row : null
  state.role = ok ? row.role || 'member' : 'guest'
  state.canManage = ok && MANAGE_ROLES.indexOf(state.role) >= 0
  state.isSuper = ok && state.role === 'super_admin'
  state.campusId = ok && row.campus_id ? row.campus_id : null
  state.profile = ok && row.kind === 'member' ? row : null
  state.roleText = ROLE_TEXT[state.role] || '队员'
  // 兼容旧页面的队长判定：可发起签到的人即视为「队长端」
  state.isCaptain = state.canManage
  if (!state.isSuper) state.viewCampusId = state.campusId
  return state.identity
}

async function loadIdentity() {
  const { data, error } = await cloud.database.rpc('my_profile', {})
  if (error) {
    applyIdentity(null)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  return applyIdentity(row)
}

async function loadCampuses() {
  const { data } = await cloud.database
    .from('campuses')
    .select('id, code, name, sort, active')
    .order('sort', { ascending: true })
  state.campuses = data || []
  return state.campuses
}

async function loadTeamName() {
  const { data } = await cloud.database
    .from('app_settings')
    .select('key, value')
    .eq('key', 'team_name')
    .maybeSingle()
  if (data && data.value) state.teamName = data.value
  return state.teamName
}

/** 当前生效校区：超管可切换，其他人固定为本校区 */
function activeCampusId() {
  if (state.isSuper) return state.viewCampusId
  return state.campusId
}

function setViewCampus(id) {
  state.viewCampusId = id
}

/** 恢复登录态：返回 uid 或 null。已有结果时复用，force=true 强制重新拉取。 */
function restore(force) {
  if (pending && !force) return pending
  pending = (async () => {
    try {
      const { data: session, error } = await cloud.auth.getSession()
      if (error || !session) {
        state.uid = null
        state.user = null
        applyIdentity(null)
        state.ready = true
        return null
      }
      state.uid = session.user.id
      state.user = session.user
      await loadIdentity()
      await loadTeamName()
      await loadCampuses()
      state.ready = true
      return state.uid
    } catch (e) {
      state.uid = null
      state.user = null
      state.viewCampusId = null
      applyIdentity(null)
      state.ready = true
      pending = null
      return null
    }
  })()
  return pending
}

/** 登录后或身份变更后强制刷新 */
async function refresh() {
  pending = null
  return restore(true)
}

/** 等待会话恢复完成，再读取 state */
async function ready() {
  await restore()
  return state.uid
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        resolve(res.code)
      },
      fail(err) {
        reject(new Error(err.errMsg || 'wx.login 失败'))
      },
    })
  })
}

/** 微信一键登录；成功后刷新 state，返回 { uid, identity } */
async function signInWithWechat() {
  const code = await wxLogin()
  const account = wx.getAccountInfoSync()
  const appid = account && account.miniProgram ? account.miniProgram.appId : ''
  const { data: session, error } = await cloud.auth.signInWithWechat(code, appid)
  if (error) {
    const e = new Error(error.message || '微信登录失败')
    e.kind = error.kind
    throw e
  }
  state.uid = session.user.id
  state.user = session.user
  const identity = await loadIdentity()
  await loadTeamName()
  await loadCampuses()
  state.ready = true
  pending = Promise.resolve(state.uid)
  return { uid: state.uid, identity: identity }
}

/** 绑定账号（姓名拼音 + 学号/密码）后刷新身份 */
async function bindIdentity(login, password) {
  const { data, error } = await cloud.database.rpc('bind_identity', {
    p_login: login,
    p_password: password,
  })
  if (error) throw new Error(error.message || '绑定失败')
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.ok) throw new Error((row && row.message) || '账号或密码不正确')
  await refresh()
  return row
}

async function signOut() {
  const result = await cloud.auth.signOut()
  if (result && result.error) throw new Error(result.error.message || '退出失败')
  state.uid = null
  state.user = null
  state.viewCampusId = null
  applyIdentity(null)
  pending = Promise.resolve(null)
}

/** 页面统一的登录守卫：未登录返回 null */
async function requireLogin() {
  const uid = await ready()
  return uid || null
}

module.exports = {
  state,
  restore,
  refresh,
  ready,
  signInWithWechat,
  bindIdentity,
  signOut,
  requireLogin,
  applyIdentity,
  activeCampusId,
  setViewCampus,
  loadCampuses,
}
