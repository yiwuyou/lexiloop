// Local circuit breaker, not a measurement of the provider's bill. Reservation
// is durable before network I/O and survives restarts and network changes.
const MAX_CALLS = 300, MAX_UNITS = 1000;
const day = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const resetAt = now => Date.parse(day(now) + 'T00:00:00+08:00') + 86400000;
function reserve(meta, action, now = Date.now()) {
  const previous = meta.requestBudget && meta.requestBudget.day === day(now) ? meta.requestBudget : { day: day(now), calls: 0, units: 0 };
  // Upload chunks include their later commit read; cleanup is bounded to 20.
  const units = action === 'wire-begin' ? 24 : action === 'wire-put' ? 4 : ['wire-get', 'status'].includes(action) ? 1 : 3;
  if (previous.calls >= MAX_CALLS || previous.units + units > MAX_UNITS) throw Object.assign(new Error('今日同步请求已达到用量保护上限，学习记录保留在本机'), { code: 'SYNC_DAILY_BUDGET', retryAt: resetAt(now) });
  meta.requestBudget = { day: previous.day, calls: previous.calls + 1, units: previous.units + units };
}
function batch(events, maxBytes = 18000) {
  const selected = []; let size = 0;
  for (const event of events.slice(0, 60)) {
    const text = JSON.stringify(event); let bytes = text.length;
    for (let i = 0; i < text.length; i++) bytes += text.charCodeAt(i) > 2047 ? 2 : text.charCodeAt(i) > 127 ? 1 : 0;
    if (selected.length && size + bytes > maxBytes) break;
    selected.push(event); size += bytes;
  }
  return selected;
}
module.exports = { reserve, batch, MAX_CALLS, MAX_UNITS, resetAt };
