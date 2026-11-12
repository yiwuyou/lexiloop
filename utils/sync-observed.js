// A stable local baseline keeps per-answer sync bookkeeping small. Publish its
// pointer only after the inactive baseline slot is durable; retain the old slot.
const model = require('./sync-model');
const storage = require('./sync-storage');
const KEY = 'lexiloop_cloud_sync_v1';
const SLOTS = ['lexiloop_cloud_observed_a_v1', 'lexiloop_cloud_observed_b_v1'];
const maps = ['cards', 'daily', 'weakBook', 'sentenceBook', 'practice'];
let baseline = null, slot = null, last = null, delta = [];
let touched = {};
function resetTouched() { touched = {}; maps.forEach(name => { touched[name] = new Set(); }); }
resetTouched();
function mark(changes) {
  changes.forEach(change => {
    const path = change.path;
    if (path[0] === 'state' && touched[path[1]] && path[2]) touched[path[1]].add(path[2]);
  });
}
function project(bundle) {
  const state = Object.assign({}, bundle.state);
  maps.forEach(name => {
    const result = {}, source = state[name] || {};
    touched[name].forEach(key => { if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key]; });
    state[name] = result;
  });
  return Object.assign({}, bundle, { state });
}
function restore(meta) {
  const ref = meta.observedRef;
  if (!ref) return;
  if (ref.version !== 1 || !SLOTS.includes(ref.key) || !Array.isArray(ref.changes)) throw Error('invalid-observed-reference');
  const value = storage.read(ref.key);
  if (!model.valid(value)) throw Error('missing-observed-baseline');
  baseline = value; slot = ref.key; delta = ref.changes; resetTouched(); mark(delta);
  meta.observed = model.overlay(model.clone(baseline), delta);
  last = meta.observed;
}
function record(meta, key, changes) {
  const value = Object.assign({}, meta, { observedRef: { version: 1, key, changes } });
  delete value.observed;
  return value;
}
function save(meta, checkpoint = false) {
  if (!meta.observed) { storage.write(KEY, meta); return; }
  if (!baseline || checkpoint) {
    const next = slot === SLOTS[0] ? SLOTS[1] : SLOTS[0];
    storage.write(next, meta.observed);
    const value = record(meta, next, []);
    storage.write(KEY, value);
    meta.observedRef = value.observedRef;
    baseline = meta.observed; slot = next; last = meta.observed; delta = []; resetTouched();
    return;
  }
  if (last !== meta.observed) delta = model.fineDiff(project(baseline), project(meta.observed));
  if (JSON.stringify(delta).length > 131072) return save(meta, true);
  const value = record(meta, slot, delta);
  storage.write(KEY, value);
  meta.observedRef = value.observedRef;
  last = meta.observed;
}
module.exports = { restore, mark, save };
