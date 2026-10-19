const { cloud } = require('./cloud')
const store = require('./store')
const time = require('./time')

const TOKEN_TTL_MS = 120000
const QR_PREFIX = 'GC'
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const STATUS_TEXT = {
  normal: '出勤',
  late: '迟到',
  leave: '请假',
  makeup: '补签',
  absent: '缺勤',
}

function statusText(status) {
  return STATUS_TEXT[status] || status || '--'
}

function randomToken() {
  let out = ''
  for (let i = 0; i < 8; i += 1) {
    out += TOKEN_CHARS.charAt(Math.floor(Math.random() * TOKEN_CHARS.length))
  }
  return out
}

function qrPayload(sessionId, token) {
  return QR_PREFIX + '|' + sessionId + '|' + token
}

/** 解析二维码内容，非法返回 null */
function parseQr(text) {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 3 || parts[0] !== QR_PREFIX) return null
  const sessionId = Number(parts[1])
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !/^[A-HJ-NP-Z2-9]{8}$/.test(parts[2])) return null
  return { sessionId: sessionId, token: parts[2] }
}

/** 令牌是否在有效期内 */
function tokenFresh(tokenUpdatedAt) {
  if (!tokenUpdatedAt) return false
  const updated = time.toDate(tokenUpdatedAt).getTime()
  if (isNaN(updated)) return false
  const age = Date.now() - updated
  return age >= 0 && age <= TOKEN_TTL_MS
}

function uid() {
  return store.state.uid
}

// ---------- 队员档案 ----------

async function fetchProfile() {
  const { data, error } = await cloud.database
    .from('members')
    .select('*')
    .eq('owner_id', uid())
    .maybeSingle()
  if (error) throw new Error(error.message)
  store.applyProfile(data)
  return data
}

async function saveProfile(input) {
  const payload = {
    name: input.name,
    student_no: input.studentNo || null,
    squad: input.squad || null,
    phone: input.phone || null,
  }
  const current = store.state.profile
  if (current && current.id) {
    const { data, error } = await cloud.database
      .from('members')
      .update(payload)
      .eq('id', current.id)
      .select()
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) throw new Error('档案更新失败，请重新登录后再试')
    store.applyProfile(data[0])
    return data[0]
  }
  const { data, error } = await cloud.database
    .from('members')
    .insert(payload)
    .select()
  if (error) {
    if (error.code === '23505') throw new Error('该账号已登记过档案')
    throw new Error(error.message)
  }
  store.applyProfile(data[0])
  return data[0]
}

async function claimCaptain(code) {
  const { data, error } = await cloud.database.rpc('claim_captain', { p_code: code })
  if (error) throw new Error(error.message || '激活失败')
  const result = Array.isArray(data) ? data[0] : data
  if (result && result.ok) {
    await store.refresh()
    return true
  }
  const e = new Error((result && result.message) || '激活码不正确')
  throw e
}

async function listMembers(campusId) {
  let query = cloud.database
    .from('members')
    .select('id, owner_id, name, student_no, squad, phone, role, title, campus_id, login_name, active, created_at')
  const cid = campusId === undefined ? store.activeCampusId() : campusId
  if (cid) query = query.eq('campus_id', cid)
  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

async function setMemberActive(id, active) {
  const { data, error } = await cloud.database.rpc('set_member_active', {
    p_member_id: id,
    p_active: active,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.ok) throw new Error((row && row.message) || '没有权限修改该队员')
  return row
}

async function resetMemberPassword(id) {
  const { data, error } = await cloud.database.rpc('reset_member_password', { p_member_id: id })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.ok) throw new Error((row && row.message) || '重置失败')
  return row
}

async function importMembers(campusId, rows) {
  const { data, error } = await cloud.database.rpc('import_members', {
    p_campus_id: campusId,
    p_rows: rows,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.ok) throw new Error((row && row.message) || '导入失败')
  return row
}

async function changeMyPassword(oldPassword, newPassword) {
  const { data, error } = await cloud.database.rpc('change_my_password', {
    p_old: oldPassword,
    p_new: newPassword,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.ok) throw new Error((row && row.message) || '修改失败')
  return row
}

// ---------- 校区与账号 ----------

async function listCampuses() {
  const { data, error } = await cloud.database
    .from('campuses')
    .select('id, code, name, sort, active')
    .order('sort', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

async function listAdmins() {
  const { data, error } = await cloud.database
    .from('admins')
    .select('id, login_name, display_name, title, role, campus_id, owner_id, active')
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// ---------- 签到场次 ----------

async function createSession(input) {
  const token = randomToken()
  const payload = {
    title: input.title,
    train_date: input.trainDate,
    late_minutes: Number(input.lateMinutes) || 0,
    qr_token: token,
    token_updated_at: new Date().toISOString(),
    status: 'open',
    owner_name: store.state.identity ? store.state.identity.name : null,
    campus_id: store.activeCampusId(),
  }
  const { data, error } = await cloud.database.from('sessions').insert(payload).select()
  if (error) {
    if (error.code === '42501') throw new Error('只有队长可以发起签到')
    throw new Error(error.message)
  }
  return data[0]
}

async function rotateToken(sessionId) {
  const token = randomToken()
  const { data, error } = await cloud.database
    .from('sessions')
    .update({ qr_token: token, token_updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('刷新二维码失败')
  return data[0]
}

async function closeSession(sessionId) {
  const { data, error } = await cloud.database
    .from('sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('结束签到失败')
  return data[0]
}

async function fetchSession(sessionId) {
  const { data, error } = await cloud.database
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

function campusFilter(query, campusId) {
  const cid = campusId === undefined ? store.activeCampusId() : campusId
  if (cid) return query.eq('campus_id', cid)
  return query
}

async function listOpenSessions(campusId) {
  let query = cloud.database.from('sessions').select('*').eq('status', 'open')
  query = campusFilter(query, campusId)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(20)
  if (error) throw new Error(error.message)
  return data || []
}

async function listSessions(limit, campusId) {
  let query = cloud.database.from('sessions').select('*')
  query = campusFilter(query, campusId)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit || 50)
  if (error) throw new Error(error.message)
  return data || []
}

async function listSessionsBetween(startDate, endDate, campusId) {
  let query = cloud.database
    .from('sessions')
    .select('*')
    .gte('train_date', startDate)
    .lte('train_date', endDate)
  query = campusFilter(query, campusId)
  const { data, error } = await query.order('train_date', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// ---------- 签到记录 ----------

async function fetchMyRecord(sessionId) {
  const { data, error } = await cloud.database
    .from('records')
    .select('*')
    .eq('session_id', sessionId)
    .eq('subject_id', uid())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function listSessionRecords(sessionId) {
  const { data, error } = await cloud.database
    .from('records')
    .select('*')
    .eq('session_id', sessionId)
    .order('signed_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

/** 一次取回多个场次的记录，避免逐场请求 */
async function listRecordsBySessions(sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return []
  const { data, error } = await cloud.database
    .from('records')
    .select('*')
    .in('session_id', sessionIds)
  if (error) throw new Error(error.message)
  return data || []
}

async function listMyRecords(limit) {
  const { data, error } = await cloud.database
    .from('records')
    .select('*')
    .eq('subject_id', uid())
    .order('signed_at', { ascending: false })
    .limit(limit || 30)
  if (error) throw new Error(error.message)
  return data || []
}

/** 队员本人签到 */
async function submitCheckin(input) {
  const payload = {
    session_id: input.sessionId,
    subject_id: uid(),
    subject_name: input.subjectName,
    photo_path: input.photoPath || null,
    status: input.status || 'normal',
    campus_id: input.campusId || store.activeCampusId(),
    client_time: input.clientTime ? new Date(input.clientTime).toISOString() : null,
  }
  const { data, error } = await cloud.database.from('records').insert(payload).select()
  if (error) {
    if (error.code === '23505') throw new Error('本场已签到，无需重复提交')
    if (error.code === '42501') throw new Error('没有权限为该队员签到')
    throw new Error(error.message)
  }
  return data[0]
}

/** 队长补签 / 标记请假 */
async function makeup(input) {
  const payload = {
    session_id: input.sessionId,
    subject_id: input.subjectId,
    subject_name: input.subjectName,
    status: input.status || 'makeup',
    remark: input.remark || null,
    makeup_by: uid(),
    campus_id: input.campusId || store.activeCampusId(),
    signed_at: new Date().toISOString(),
  }
  const { data, error } = await cloud.database.from('records').insert(payload).select()
  if (error) {
    if (error.code === '23505') throw new Error('该队员本场已有记录')
    if (error.code === '42501') throw new Error('只有队长可以补签')
    throw new Error(error.message)
  }
  return data[0]
}

async function updateRecordStatus(recordId, status, remark) {
  const patch = { status: status }
  if (remark !== undefined) patch.remark = remark
  const { data, error } = await cloud.database
    .from('records')
    .update(patch)
    .eq('id', recordId)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('没有权限修改该记录')
  return data[0]
}

async function removeRecord(recordId) {
  const { data, error } = await cloud.database
    .from('records')
    .delete()
    .eq('id', recordId)
    .select()
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('没有权限删除该记录')
  return true
}

// ---------- 照片 ----------

function compressImage(src) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: src,
      quality: 60,
      compressedWidth: 1080,
      success(res) {
        resolve(res.tempFilePath || src)
      },
      fail() {
        resolve(src)
      },
    })
  })
}

function readFileBuffer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      success(res) {
        resolve(res.data)
      },
      fail(err) {
        reject(new Error(err.errMsg || '读取照片失败'))
      },
    })
  })
}

/** 上传照片到共享目录，队长才能查看 */
async function uploadPhoto(tempFilePath) {
  const compressed = await compressImage(tempFilePath)
  const buffer = await readFileBuffer(compressed)
  const name = 'checkin/' + Date.now() + '_' + Math.floor(Math.random() * 1000000) + '.jpg'
  const path = cloud.storage.sharedPath(uid(), name)
  const result = await cloud.storage.upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (result.error) throw new Error(result.error.message || '照片上传失败')
  return path
}

async function signedUrl(path) {
  const result = await cloud.storage.createSignedUrl(path, 600)
  if (result.error) throw new Error(result.error.message || '获取照片链接失败')
  const data = result.data
  if (typeof data === 'string') return data
  if (data && data.url) return data.url
  if (data && data.signedUrl) return data.signedUrl
  throw new Error('获取照片链接失败')
}

// ---------- 月度统计 ----------

async function monthData(yearMonth, campusId) {
  const startDate = yearMonth + '-01'
  const lastDay = new Date(Number(yearMonth.slice(0, 4)), Number(yearMonth.slice(5, 7)), 0).getDate()
  const endDate = yearMonth + '-' + time.pad(lastDay)
  const sessions = await listSessionsBetween(startDate, endDate, campusId)
  const ids = sessions.map(function (s) {
    return s.id
  })
  let records = []
  if (ids.length > 0) {
    const { data, error } = await cloud.database
      .from('records')
      .select('*')
      .in('session_id', ids)
    if (error) throw new Error(error.message)
    records = data || []
  }
  const members = await listMembers(campusId)
  return { sessions: sessions, records: records, members: members }
}

module.exports = {
  TOKEN_TTL_MS,
  statusText,
  STATUS_TEXT,
  randomToken,
  qrPayload,
  parseQr,
  tokenFresh,
  fetchProfile,
  listMembers,
  setMemberActive,
  resetMemberPassword,
  importMembers,
  changeMyPassword,
  listCampuses,
  listAdmins,
  createSession,
  rotateToken,
  closeSession,
  fetchSession,
  listOpenSessions,
  listSessions,
  submitCheckin,
  fetchMyRecord,
  listSessionRecords,
  listRecordsBySessions,
  listMyRecords,
  makeup,
  updateRecordStatus,
  removeRecord,
  uploadPhoto,
  signedUrl,
  monthData,
}
