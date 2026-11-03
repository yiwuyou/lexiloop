// Coalesce replaceable snapshots only. Never merge answer/card events, cross
// ownership epochs, delete sequence IDs or mutate a batch already in flight.
const samePath = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function snapshots(outbox, changes, epoch) {
  let pending = outbox;
  const next = changes.map(change => {
    const path = change.path;
    const session = path.length === 1;
    const daily = path.length === 3 && path[0] === 'state' && path[1] === 'daily';
    if (!session && !daily) return change;
    let before = change.before, found = false;
    pending = pending.map(event => {
      if (event.epoch !== epoch) return event;
      const oldChanges = event.changes.filter(old => {
        if (!samePath(old.path, path)) return true;
        if (!found) { before = old.before; found = true; }
        return false;
      });
      return oldChanges.length === event.changes.length ? event : Object.assign({}, event, { changes: oldChanges });
    });
    return Object.assign({}, change, { before: session ? null : before });
  });
  return { outbox: pending, changes: next };
}
module.exports = { snapshots };
