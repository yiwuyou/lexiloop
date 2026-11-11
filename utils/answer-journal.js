// A small durable delta precedes UI updates. Full compressed checkpoints are
// folded later, while reads use the working image reconstructed in memory.
const storage = require('./sync-storage');
const model = require('./sync-model');
const KEY = 'mem_vocab_answer_apply_v1';
const ROOTS = {
  state: 'mem_vocab_state_v1',
  session: 'mem_vocab_session_v1',
  practiceSession: 'mem_vocab_practice_session_v1',
};
const coreFields = new Set(['cards', 'daily', 'weakBook', 'sentenceBook', 'practice', 'recentReviews', 'progressRecovery', 'recoveryRelease']);
let base = null, current = null, dirty = false, recovered = false, timer = null;
let touched = new Set();
function reset() {
  clearTimeout(timer); timer = null;
  base = null; current = null; dirty = false; recovered = false; touched = new Set();
}
function schedule() {
  if (timer || !dirty) return;
  timer = setTimeout(() => {
    timer = null;
    try { flush(); } catch (_) { /* Retain the delta; the next save or app hide retries. */ }
  }, 30000);
  if (timer && timer.unref) timer.unref();
}
function initialize() {
  if (current) return;
  try {
    base = { settings: { schemaVersion: 2 } };
    Object.entries(ROOTS).forEach(([field, key]) => { base[field] = storage.read(key) || null; });
    current = base;
    const pending = storage.read(KEY);
    if (!pending) return;
    if (pending.format === 2) {
      if (!base.state || !Array.isArray(pending.changes) || !Array.isArray(pending.extras)) throw Error('invalid-answer-journal');
      current = model.overlay(model.clone(base), pending.changes);
      pending.extras.forEach(change => {
        if (['__proto__', 'constructor', 'prototype'].includes(change.key)) throw Error('invalid-answer-journal');
        if (change.remove) delete current.state[change.key]; else current.state[change.key] = change.after;
      });
      pending.changes.forEach(change => {
        if (change.path[0] === 'state' && ['cards', 'weakBook'].includes(change.path[1])) touched.add(change.path[2]);
      });
    } else {
      if (!pending.state || pending.state.schemaVersion !== 3 || !pending.session || !Array.isArray(pending.session.queue)) throw Error('invalid-answer-journal');
      current = Object.assign({}, base, {
        state: pending.state,
        [pending.session.mode === 'practice' ? 'practiceSession' : 'session']: pending.session,
      });
      Object.keys(current.state.cards).forEach(id => touched.add(id));
      Object.keys(current.state.weakBook).forEach(id => touched.add(id));
    }
    recovered = true; dirty = true; schedule();
  } catch (error) { reset(); throw error; }
}
function resume() {
  initialize();
  const value = recovered; recovered = false;
  return value;
}
function read(key) {
  initialize();
  const field = Object.keys(ROOTS).find(field => ROOTS[field] === key);
  return field ? model.clone(current[field]) : storage.read(key);
}
function project(value) {
  const pick = map => Object.fromEntries([...touched].filter(id => Object.prototype.hasOwnProperty.call(map || {}, id)).map(id => [id, map[id]]));
  return Object.assign({}, value, { state: Object.assign({}, value.state, {
    cards: pick(value.state.cards), weakBook: pick(value.state.weakBook),
  }) });
}
function save(parts, ids) {
  initialize();
  if (!base.state || base.state.schemaVersion !== 3) throw Error('answer-checkpoint-required');
  const next = Object.assign({}, current, model.clone(parts));
  if (ids == null) {
    Object.keys(base.state.cards).concat(Object.keys(next.state.cards), Object.keys(base.state.weakBook), Object.keys(next.state.weakBook)).forEach(id => touched.add(id));
  } else (Array.isArray(ids) ? ids : [ids]).forEach(id => touched.add(id));
  const changes = model.fineDiff(project(base), project(next));
  // Fine cloud deltas omit newly created empty maps; local recovery retains
  // them as well so the checkpoint is an exact working image.
  Object.entries(next.state.daily || {}).forEach(([day, value]) => {
    const before = base.state.daily[day] || {};
    if (!Object.keys(value).length && !base.state.daily[day]) changes.push({ path: ['state', 'daily', day], after: {} });
    Object.entries(value).forEach(([key, field]) => {
      if (field && !Array.isArray(field) && typeof field === 'object' && !Object.keys(field).length && before[key] == null) {
        changes.push({ path: ['state', 'daily', day, key], after: {} });
      }
    });
  });
  const extras = [];
  new Set(Object.keys(base.state).concat(Object.keys(next.state))).forEach(key => {
    const field = next.state[key];
    const emptyMapAdded = ['sentenceBook', 'practice'].includes(key) && base.state[key] == null
      && field && typeof field === 'object' && !Object.keys(field).length;
    if (coreFields.has(key) && !emptyMapAdded || JSON.stringify(base.state[key]) === JSON.stringify(field)) return;
    extras.push({ key, after: next.state[key], remove: !Object.prototype.hasOwnProperty.call(next.state, key) });
  });
  storage.write(KEY, { format: 2, changes, extras });
  current = next; dirty = true; schedule();
}
function flush() {
  initialize();
  if (!dirty) return;
  Object.entries(ROOTS).forEach(([field, key]) => {
    if (current[field]) storage.write(key, current[field]); else storage.remove(key);
  });
  storage.remove(KEY);
  base = current; dirty = false; touched.clear();
  clearTimeout(timer); timer = null;
}
function has(key) { return Object.values(ROOTS).includes(key); }
module.exports = { read, save, flush, reset, resume, has };
