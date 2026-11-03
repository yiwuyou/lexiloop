const assert = require('assert');
const model = require('../utils/sync-model');
const { snapshots } = require('../utils/sync-outbox');
const clone = model.clone;
const day = '2026-11-03';
const base = { state: { schemaVersion: 3, cards: {}, daily: {}, weakBook: {}, sentenceBook: {}, recentReviews: [] }, settings: { schemaVersion: 2 }, session: { queue: [], index: 0 }, practiceSession: null };
let bundle = clone(base), compact = [];
const original = [];
for (let i = 0; i < 8; i++) {
  const next = clone(bundle);
  next.state.cards['synthetic-' + i] = { seen: true, reps: 1, dueAt: 1000, lastAt: i + 1 };
  next.state.recentReviews.push({ id: 'answer-' + i, at: i + 1, day, wordId: 'synthetic-' + i, phase: 'review', result: 'good' });
  // Use the complete day shape created by store.js, including zero counters.
  next.state.daily[day] = Object.assign({ newDone: 0, backlogDone: 0, newGoal: 50, reinforcementDone: 0, contextDone: 0, contextCorrect: 0, sentenceDone: 0, sentenceCorrect: 0, minutes: 0, extraNew: 0, completedAt: 0 }, next.state.daily[day], { dueDone: i + 1, dueGoal: 100, firstAnswers: { ...(next.state.daily[day] || {}).firstAnswers, ['synthetic-' + i]: 'review' }, time: { version: 1, legacySeconds: 0, segments: { ...((next.state.daily[day] || {}).time || {}).segments, ['s-' + i]: { start: i * 10000, end: i * 10000 + 9000, phase: 'review' } } } });
  next.session.index = i + 1;
  const event = { device: 'offline-owner', epoch: 1, seq: i + 1, baseRev: 1, changes: model.diff(bundle, next) };
  original.push(clone(event));
  const before = JSON.stringify(compact), changesBefore = JSON.stringify(event.changes);
  const result = snapshots(compact, event.changes, 1);
  assert.strictEqual(JSON.stringify(compact), before, 'compaction never mutates a batch already in flight');
  assert.strictEqual(JSON.stringify(event.changes), changesBefore, 'captured preimages remain immutable');
  compact = result.outbox.concat({ ...event, changes: result.changes });
  bundle = next;
}
assert.deepStrictEqual(compact.map(e => e.seq), original.map(e => e.seq), 'all sequence IDs remain acknowledgeable');
assert.strictEqual(compact.flatMap(e => e.changes).filter(c => c.path[1] === 'daily').length, 1);
assert.strictEqual(compact.flatMap(e => e.changes).filter(c => c.path[1] === 'cards').length, 8);
assert.strictEqual(compact.flatMap(e => e.changes).filter(c => c.append).flatMap(c => c.append).length, 8);
function apply(events, target = clone(base), firstRev = 1, versions = {}) {
  for (const e of events) model.apply(target, e, { owner: { device: 'offline-owner', epoch: 1 }, versions, nextRev: firstRev + e.seq });
  return target;
}
const expected = apply(original);
assert.deepStrictEqual(apply(compact), expected, 'coalescing daily snapshots cannot change answers, counters, timing or the task');
const inFlightApplied = apply(original.slice(0, 4));
assert.deepStrictEqual(apply(compact.slice(4), inFlightApplied), expected, 'acknowledging an old in-flight image before the latest one is safe');
const concurrent = apply(original.slice(0, 4));
concurrent.state.daily[day].time.segments['other-device'] = { start: 100000, end: 109000, phase: 'detail' };
const mixed = apply(compact.slice(4), concurrent);
assert.ok(mixed.state.daily[day].time.segments['other-device'], 'another device timing interval survives conservative merge');
assert.strictEqual(Object.keys(mixed.state.daily[day].time.segments).length, 9);
const oldEpoch = { ...original[0], epoch: 0 };
const result = snapshots([oldEpoch], original[1].changes, 1);
assert.strictEqual(result.outbox[0], oldEpoch, 'ownership epochs never coalesce');
const latest = compact.flatMap(e => e.changes).find(c => c.path[1] === 'daily');
assert.strictEqual(latest.before, null, 'first absent-day preimage is preserved, not replaced with a later snapshot');
console.log('Outbox snapshots: replay equivalence, all answer/sequence IDs, in-flight immutability, cross-device timing and ownership boundaries passed.');
