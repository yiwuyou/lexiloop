const model = require('./model.generated');
function compact(changes) {
  const values = new Map();
  for (const change of changes) {
    const key = JSON.stringify(change.path), previous = values.get(key);
    if (change.append) {
      const reviews = new Map();
      (previous && previous.append || []).concat(change.append).forEach(item => reviews.set(item.id || JSON.stringify(item), item));
      values.set(key, { path: change.path, append: Array.from(reviews.values()).slice(-3000) });
    } else values.set(key, { path: change.path, after: change.after == null ? null : change.after });
  }
  return Array.from(values.values());
}
function recordDelta(record, before, from, events = []) {
  const changes = model.diff(before, record.bundle);
  // Include paths that were rejected or resolved to their previous value too:
  // a stale device must discard its rejected task image, not keep it locally.
  for (const event of events) for (const change of event.changes) {
    if (change.path[1] === 'recentReviews') continue;
    let value = record.bundle;
    for (const key of change.path) value = value == null ? null : value[key];
    changes.push({ path: change.path, after: value == null ? null : value });
  }
  record.deltas = (record.deltas || []).concat({ from, rev: record.rev, changes: compact(changes) }).slice(-24);
  while (JSON.stringify(record.deltas).length > 200000) record.deltas.shift();
}
function since(record, rev) {
  if (!Number.isSafeInteger(rev) || rev < 1 || rev >= record.rev) return null;
  let cursor = rev;
  const changes = [];
  for (const entry of record.deltas || []) {
    if (entry.rev <= cursor) continue;
    if (entry.from !== cursor) return null;
    changes.push(...entry.changes); cursor = entry.rev;
  }
  return cursor === record.rev ? { baseRev: rev, changes: compact(changes) } : null;
}
module.exports = { recordDelta, since };
