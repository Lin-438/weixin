// 无校区信息的旧数据仍按原有规则处理。
function applies(member, session) {
  return !member.campus_id || !session.campus_id || String(member.campus_id) === String(session.campus_id)
}
module.exports = { applies }
