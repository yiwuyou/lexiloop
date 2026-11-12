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
  // Sweep interval boundaries once. The newest active interval owns each
  // slice, with the same phase tie-break as the original overlap calculation.
  spans.sort((a, b) => a.start - b.start);
  const points = [];
  spans.forEach(span => { points.push(span.start, span.end); });
  points.sort((a, b) => a - b);
  const heap = [];
  const higher = (a, b) => a.start > b.start || a.start === b.start && a.phase.localeCompare(b.phase) < 0;
  const push = value => {
    let index = heap.length; heap.push(value);
    while (index) {
      const parent = Math.floor((index - 1) / 2);
      if (!higher(value, heap[parent])) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = value;
  };
  const pop = () => {
    const value = heap.pop();
    if (!heap.length) return;
    let index = 0;
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && higher(heap[child + 1], heap[child])) child++;
      if (!higher(heap[child], value)) break;
      heap[index] = heap[child]; index = child;
    }
    heap[index] = value;
  };
  let milliseconds = 0, next = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const begin = points[i], end = points[i + 1];
    if (end <= begin) continue;
    while (next < spans.length && spans[next].start <= begin) push(spans[next++]);
    while (heap.length && heap[0].end <= begin) pop();
    if (!heap.length) continue;
    const duration = end - begin;
    milliseconds += duration; result[heap[0].phase] += duration / 1000;
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
