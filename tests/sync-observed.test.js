const assert = require('assert/strict');
const model = require('../utils/sync-model'), storage = require('../utils/sync-storage');
const clone = model.clone, KEY = 'lexiloop_cloud_sync_v1';
const values = {}, writes = [];
let failKey = '';
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync(key, value) {
    if (key === failKey) throw Error('injected-write-failure');
    values[key] = clone(value); writes.push({ key, bytes: Buffer.byteLength(JSON.stringify(value)) });
  },
  removeStorageSync: key => { delete values[key]; },
};
function freshModule() { delete require.cache[require.resolve('../utils/sync-observed')]; return require('../utils/sync-observed'); }
function loaded() {
  const helper = freshModule(), meta = storage.read(KEY);
  helper.restore(meta);
  return { helper, meta };
}
const bundle = { state: { schemaVersion: 3, cards: {}, daily: {}, weakBook: {}, recentReviews: [] }, settings: { schemaVersion: 2 }, session: { day: '2026-11-12', startedAt: 1, index: 0, queue: [] }, practiceSession: null };
for (let i = 0; i < 1600; i++) {
  bundle.state.cards['word-' + i] = { seen: true, reps: 3, dueAt: i, note: 'Retain every existing memory field and its original review history.' };
}
for (let i = 0; i < 3000; i++) bundle.state.recentReviews.push({ id: 'review-' + i, wordId: 'word-' + i % 1600, at: i, phase: 'review', result: 'good', note: 'Historical answer retained in the shared baseline.' });
bundle.session.queue = Array.from({ length: 150 }, (_, i) => ({ wordId: 'word-' + i, phase: 'review' }));
let helper = freshModule(), meta = { observed: clone(bundle), seq: 0, outbox: [], enabled: true };
// Migrate the exact older metadata shape without replacing learning records.
storage.write(KEY, meta);
helper.save(meta);
assert.ok(storage.read(KEY).observedRef && !storage.read(KEY).observed);
const baselineKey = storage.read(KEY).observedRef.key;
const baselineBefore = clone(values[baselineKey]);
writes.length = 0;
for (let i = 0; i < 10; i++) {
  const previous = meta.observed, next = clone(previous);
  next.state.cards['word-' + i].reps++;
  next.state.daily['2026-11-12'] = { dueDone: i + 1, firstAnswers: Object.assign({}, previous.state.daily['2026-11-12'] && previous.state.daily['2026-11-12'].firstAnswers, { ['word-' + i]: 'review' }) };
  next.state.recentReviews.push({ id: 'new-' + i, wordId: 'word-' + i, at: 4000 + i, result: 'again' }); next.state.recentReviews = next.state.recentReviews.slice(-3000);
  next.session.index++;
  next.session.queue.splice(20 + i, 0, { wordId: 'word-' + i, phase: 'sentence' });
  const changes = model.fineDiff(previous, next);
  helper.mark(changes); meta.observed = next; meta.seq++; meta.outbox.push({ seq: meta.seq, changes });
  helper.save(meta);
}
assert.equal(writes.length, 10, 'each observation update is one metadata write');
assert.ok(writes.every(item => item.key === KEY && item.bytes < 48000), 'observations never rewrite or compress the whole learning baseline per answer');
assert.deepEqual(values[baselineKey], baselineBefore);
const latest = clone(meta.observed), persisted = clone(values[KEY]);
let reopened = loaded();
assert.ok(model.equal(reopened.meta.observed, latest), 'answers, queue splices and first-answer counts reconstruct after a restart');
assert.equal(reopened.meta.outbox.length, 10);
// Failure while publishing an inactive baseline cannot invalidate the old pointer.
for (const key of [KEY, baselineKey.includes('_a_') ? 'lexiloop_cloud_observed_b_v1' : 'lexiloop_cloud_observed_a_v1']) {
  helper = reopened.helper; meta = reopened.meta; failKey = key;
  assert.throws(() => helper.save(meta, true));
  assert.deepEqual(values[KEY], persisted);
  failKey = '';
  reopened = loaded();
  assert.ok(model.equal(reopened.meta.observed, latest));
}
reopened.helper.save(reopened.meta, true);
const folded = loaded();
assert.ok(model.equal(folded.meta.observed, latest));
assert.equal(storage.read(KEY).observedRef.changes.length, 0);
assert.equal(folded.meta.outbox.length, 10, 'observation folding never acknowledges or removes pending uploads');
console.log('Sync observation baseline: legacy migration, ten small writes, queue/review reconstruction and interrupted pointer publication passed.');
