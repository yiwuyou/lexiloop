const model = require('./model.generated');
function compact(changes) {
  const values = [], reviews = new Map();
  for (const change of changes) {
    if (change.append) {
      change.append.forEach(item => reviews.set(item.id || JSON.stringify(item), item));
    } else values.push(change.splice ? change : { path: change.path, after: change.after == null ? null : change.after });
  }
  if (reviews.size) values.push({ path: ['state', 'recentReviews'], append: Array.from(reviews.values()).slice(-3000) });
  return values;
}
function valueAt(bundle, path) { let value = bundle; for (const key of path) value = value == null ? null : value[key]; return value == null ? null : value; }
function recordDelta(record, before, from, events = []) {
  const changes = model.fineDiff(before, record.bundle);
  // Include paths that were rejected or resolved to their previous value too:
  // a stale device must discard its rejected task image, not keep it locally.
  const proposed = new Map();
  for (const event of events) for (const change of event.changes) proposed.set(JSON.stringify(change.path), change);
  for (const change of proposed.values()) {
    if (change.path[1] === 'recentReviews') continue;
    const value = valueAt(record.bundle, change.path);
    if (change.splice) {
      if (model.fingerprint(value) !== change.splice.after) changes.push({ path: [change.path[0]], after: valueAt(record.bundle, [change.path[0]]) });
    } else if (!model.equal(value, change.after)) changes.push({ path: change.path, after: value });
  }
  record.deltas = (record.deltas || []).concat({ from, rev: record.rev, changes: compact(changes) }).slice(-24);
  while (JSON.stringify(record.deltas).length > 200000) record.deltas.shift();
}
function since(record, rev, format = 1) {
  if (!Number.isSafeInteger(rev) || rev < 1 || rev >= record.rev) return null;
  let cursor = rev;
  const changes = [];
  for (const entry of record.deltas || []) {
    if (entry.rev <= cursor) continue;
    if (entry.from !== cursor) return null;
    changes.push(...entry.changes); cursor = entry.rev;
  }
  if (cursor !== record.rev) return null;
  if (format === 2) return { format: 2, baseRev: rev, changes: compact(changes) };
  // Old clients understand only day/card objects and whole task images.
  const legacy = new Map();
  for (const change of compact(changes)) {
    if (change.append) { legacy.set('reviews', change); continue; }
    const path = ['session', 'practiceSession'].includes(change.path[0]) ? change.path.slice(0, 1)
      : change.path[1] === 'daily' ? change.path.slice(0, 3) : change.path;
    legacy.set(JSON.stringify(path), { path, after: valueAt(record.bundle, path) });
  }
  return { baseRev: rev, changes: Array.from(legacy.values()) };
}
module.exports = { recordDelta, since };
