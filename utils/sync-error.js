const LABELS = { init: '初始化云连接', status: '读取云端存档', bootstrap: '首次上传', attach: '合并本机记录', sync: '同步变化', claim: '接续学习任务', apply: '保存云端返回记录', local: '保存本机同步队列', 'transaction-read': '读取云端事务', 'snapshot-write': '保存云端快照', 'record-write': '写入云端存档', 'transaction-commit': '提交云端事务' };
function safeText(value, limit = 280) {
  return String(value || '').replace(/(?:openid|unionid|secret(?:id|key)?|access[_-]?token|authorization)\s*[=:：]\s*["']?[^\s,"'}]+/gi, '[已隐藏]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').split(/\b(?:bundle|payload|changes)\s*[=:]/i)[0].slice(0, limit);
}
function describe(error = {}, fallback = 'local') {
  const raw = String(error.errMsg || error.message || '未提供错误信息');
  const extracted = raw.match(/errCode\s*[:=]\s*(-?\d+)/i);
  const candidate = error.code != null ? error.code : error.errCode != null ? error.errCode : extracted ? extracted[1] : 'SYNC_UNKNOWN';
  const code = /^[a-zA-Z0-9_.-]{1,100}$/.test(String(candidate)) ? String(candidate) : 'SYNC_UNKNOWN';
  const stage = error.syncStage || fallback;
  let hint = '本机记录已保留，请把这里的失败步骤和错误码发给开发者；无需清缓存或重新授权。';
  if (/env not exists|invalid env|非法的\s*env/i.test(raw)) hint = '微信端未识别目标云环境。需核对原生小程序调用链；不要再授权微搭。';
  else if (/IDENTITY_REQUIRED/.test(code)) hint = '云函数没有取得预期的微信身份，需要检查调用链；不要重置学习进度。';
  else if (/SYNC_TIMEOUT|timeout|超时/i.test(`${code} ${raw}`)) hint = '本次请求超时，记录仍在本机；稍后重试不会覆盖已有云档。';
  else if (/storage|disk|quota|存储|空间/i.test(raw)) hint = '本机写入未完成。请勿清理此小程序缓存，需先处理存储错误。';
  const request = safeText(error.syncRequestId || '', 100).replace(/[^a-zA-Z0-9_.:-]/g, '');
  return { code, stage, label: LABELS[stage] || stage, detail: safeText(raw), request, hint };
}
function format(value) {
  if (!value) return '';
  return `失败步骤：${value.label}\n错误码：${value.code}\n具体原因：${value.detail}${value.request ? `\n请求号：${value.request}` : ''}\n${value.hint}`;
}
module.exports = { describe, format };
