// Coalesce replaceable snapshots only. Never merge answer/card events, cross
// ownership epochs, delete sequence IDs or mutate a batch already in flight.
function snapshots(outbox, changes, epoch) {
  const replacements = new Map();
  const next = changes.map(change => {
    const path = change.path;
    const session = path[0] === 'session' || path[0] === 'practiceSession';
    const daily = path[0] === 'state' && path[1] === 'daily' && path.length >= 3;
    if (change.splice || (!session && !daily)) return change;
    const result = Object.assign({}, change);
    const root = session && path.length === 1;
    if (root) result.before = null;
    const key = JSON.stringify(path);
    if (!replacements.has(key)) replacements.set(key, { result, root, found: false });
    return result;
  });
  const pending = !replacements.size ? outbox : outbox.map(event => {
    if (event.epoch !== epoch) return event;
    const kept = event.changes.filter(old => {
      const entry = replacements.get(JSON.stringify(old.path));
      if (!entry) return true;
      if (!entry.found && !entry.root) entry.result.before = old.before;
      entry.found = true;
      return false;
    });
    return kept.length === event.changes.length ? event : Object.assign({}, event, { changes: kept });
  });
  return { outbox: pending, changes: next };
}
module.exports = { snapshots };
