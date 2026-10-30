// Pure client/server ledger. Intervals use epoch milliseconds and Shanghai days.
const OFFSET = 8 * 3600000;
const PHASES = ['review', 'new', 'reinforcement', 'sentence', 'context', 'practice', 'detail'];
function dayKey(at) { return new Date(at + OFFSET).toISOString().slice(0, 10); }
function bounds(day) { const start = Date.parse(day + 'T00:00:00+08:00'); return [start, start + 86400000]; }
function merge(left = {}, right = {}) {
  const segments = Object.assign({}, left.segments || {});
  Object.entries(right.segments || {}).forEach(([id, value]) => {
    if (!value || !PHASES.includes(value.phase) || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start) return;
    const old = segments[id];
    if (!old || value.end > old.end) segments[id] = value;
  });
  return { version: 1, legacySeconds: Math.max(left.legacySeconds || 0, right.legacySeconds || 0), segments };
}
function summary(daily = {}, day) {
  const ledger = daily.time;
  const result = Object.fromEntries(PHASES.map(phase => [phase, 0]));
  const legacySeconds = ledger ? ledger.legacySeconds || 0 : (daily.minutes || 0) * 60;
  const [lo, hi] = bounds(day);
  const spans = Object.values(ledger && ledger.segments || {}).filter(s => s && PHASES.includes(s.phase))
    .map(s => ({ start: Math.max(lo, s.start), end: Math.min(hi, s.end), phase: s.phase }))
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  const points = [...new Set(spans.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
  let milliseconds = 0;
  for (let i = 1; i < points.length; i++) {
    // Count overlapping devices once. Attribute the slice to the most recently
    // entered phase, using a stable tie-break instead of device identifiers.
    const active = spans.filter(s => s.start <= points[i - 1] && s.end >= points[i])
      .sort((a, b) => b.start - a.start || a.phase.localeCompare(b.phase));
    if (!active.length) continue;
    const duration = points[i] - points[i - 1];
    milliseconds += duration; result[active[0].phase] += duration / 1000;
  }
  return { seconds: Math.floor(milliseconds / 1000) + legacySeconds, legacySeconds, phases: result };
}
function format(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  if (!value) return '0分钟';
  if (value < 60) return value + '秒';
  return Math.floor(value / 60) + '分' + (value % 60 ? value % 60 + '秒' : '钟');
}
module.exports = { PHASES, dayKey, bounds, merge, summary, format };
