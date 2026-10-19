const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')

// 仅存放 publicConfig 中允许下发到前端的两个值，不含任何长期密钥。
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_qROxauSaGjMS9JfWwQhnoi_tyLTVkWB2wzt2KHUIsOUABZlgAjHGV5e',
}

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx),
})

module.exports = { cloud, publicConfig }
