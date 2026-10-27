const assert = require('assert');
const clone = value => JSON.parse(JSON.stringify(value));
const repair = require('../utils/recovery-release');
const plan = require('../utils/study-plan');
const { getWords } = require('../utils/words');
const { review, isStable } = require('../utils/scheduler');
const { dayKey, DAY_MS } = require('../utils/date');
const now = new Date(2026, 9, 27, 12).getTime();
const empty = { schemaVersion: 3, createdAt: now, cards: {}, daily: {}, weakBook: {}, recentReviews: [] };
const settings = { dailyNewCount: 50, dailyReviewLimit: 100, dailyBacklogLimit: 30 };

const next = repair.prepare(empty, now);
assert.deepStrictEqual(empty.cards, {}, 'prepare never mutates the input');
assert.strictEqual(next.recoveryRelease, repair.REPAIR_ID);
assert.strictEqual(plan.progressStats(next).learned, 1036);
assert.strictEqual(plan.progressStats(next).stable, 0);
assert.strictEqual(plan.progressStats(next).learning, 1036);
assert.deepStrictEqual(next.daily, {}, 'no invented old learning days');
assert.deepStrictEqual(next.recentReviews, [], 'no invented old answers');
assert.ok(getWords().filter(word => word.category === 'core' || word.category === 'high' && word.day < 13)
  .every(word => next.cards[word.id].seen && next.cards[word.id].reps === 0 && !isStable(next.cards[word.id])));
const summary = plan.summarize(next, settings, now);
assert.strictEqual(summary.remainingReviewCount, 1036);
assert.strictEqual(summary.scheduledDue.length, 100);
assert.strictEqual(summary.deferredRecoveryCount, 936);
assert.strictEqual(summary.unseen[0].id, 'h-13-1');
const session = plan.buildSession(next, settings, now);
assert.strictEqual(session.dueGoal, 100);
assert.strictEqual(session.newGoal, 50);
assert.strictEqual(session.queue.filter(item => item.phase === 'review').length, 100);
assert.strictEqual(session.queue.find(item => item.phase === 'new').wordId, 'h-13-1');
assert.strictEqual(plan.summarize(next, { dailyNewCount: 50 }, now).scheduledDue.length, 100,
  'planner fallback must also use 100');
assert.strictEqual(plan.summarize(next, settings, now + 7 * DAY_MS).scheduledDue.length, 100,
  'missing days does not reduce recovered words to the 30-word backlog cap');
// Passing a recovered word removes its unverified status, while daily first-pass
// counters prevent another hundred from being created by leaving and resuming.
const answered = clone(next);
session.queue.filter(item => item.phase === 'review').forEach(item => {
  answered.cards[item.wordId] = review(answered.cards[item.wordId], 'good', now);
});
answered.daily[dayKey(now)] = { dueDone: 100, dueGoal: 100, backlogDone: 0 };
assert.strictEqual(plan.summarize(answered, settings, now).remainingReviewCount, 936);
assert.strictEqual(plan.buildSession(answered, settings, now).queue.filter(item => item.phase === 'review').length, 0);
assert.strictEqual(repair.prepare(answered, now + DAY_MS), null,
  'reopening must never reset real post-recovery answers');

const existing = clone(empty);
existing.cards['c-1-1'] = review(null, 'easy', now);
existing.cards['h-14-1'] = review(null, 'good', now);
existing.sentenceBook = { saved: { sentence: 'Keep this.' } };
existing.weakBook = { 'c-1-1': { addedAt: now } };
existing.recentReviews = [{ at: now, wordId: 'c-1-1', result: 'easy' }];
existing.daily[dayKey(now)] = { dueDone: 50, dueGoal: 50, newDone: 0, newGoal: 50, completedAt: now };
const rechecked = repair.prepare(existing, now);
assert.strictEqual(rechecked.cards['c-1-1'].reps, 0, 'all requested previous words need rechecking, even if already marked learned');
assert.deepStrictEqual(rechecked.cards['h-14-1'], existing.cards['h-14-1'], 'never overwrite records beyond the checkpoint');
assert.deepStrictEqual(rechecked.sentenceBook, existing.sentenceBook);
assert.deepStrictEqual(rechecked.weakBook, existing.weakBook);
assert.deepStrictEqual(rechecked.recentReviews, existing.recentReviews);
assert.strictEqual(rechecked.daily[dayKey(now)].dueDone, 0);
assert.strictEqual(rechecked.daily[dayKey(now)].dueGoal, 100);

const values = {};
let failBackup = false, failState = false, failRemove = false;
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync(key, value) {
    if (failBackup && key === repair.BACKUP_KEY || failState && key === 'mem_vocab_state_v1') throw new Error('disk-full');
    values[key] = clone(value);
  },
  removeStorageSync(key) { if (failRemove) throw new Error('cannot-remove'); delete values[key]; },
};
const store = require('../utils/store');
store.saveState(empty);
values.mem_vocab_settings_v1 = { schemaVersion: 2, dailyReviewLimit: 80, dailyNewCount: 50 };
assert.strictEqual(store.getSettings().dailyReviewLimit, 100, 'existing saved 80-word settings must migrate');
store.saveSession({ day: dayKey(now), queue: [{ phase: 'new', wordId: 'c-1-1' }], index: 0 });
store.saveSession({ mode: 'practice', queue: [{ phase: 'practice', wordId: 'c-1-1' }], index: 0 });
const before = clone(values);
failBackup = true;
assert.throws(() => repair.run(store, now), /disk-full/);
assert.deepStrictEqual(values, before, 'backup failure aborts all recovery writes');
failBackup = false;
failRemove = true;
assert.throws(() => repair.run(store, now), /cannot-clear-old-task/);
assert.strictEqual(store.getState().recoveryRelease, undefined, 'failed session clear is retryable');
failRemove = false;
failState = true;
assert.throws(() => repair.run(store, now), /disk-full/);
assert.strictEqual(store.getState().recoveryRelease, undefined, 'failed final write cannot commit the marker');
failState = false;
assert.strictEqual(repair.run(store, now), true);
assert.strictEqual(store.getSession(), null);
assert.strictEqual(store.getSession('practice'), null);
assert.deepStrictEqual(values[repair.BACKUP_KEY].state, empty);
assert.deepStrictEqual(values[repair.BACKUP_KEY].session, before.mem_vocab_session_v1);
assert.deepStrictEqual(values[repair.BACKUP_KEY].practiceSession, before.mem_vocab_practice_session_v1);
const durable = clone(values);
assert.strictEqual(repair.run(store, now + DAY_MS), false);
assert.deepStrictEqual(values, durable, 'subsequent launches do not rewrite anything');

// The real application entry executes the repair before pages read progress.
values.mem_vocab_state_v1 = clone(empty);
let app;
global.App = definition => { app = definition; };
wx.onNetworkStatusChange = () => {};
wx.showToast = () => { throw new Error('unexpected repair failure'); };
require('../app');
app.onLaunch();
assert.strictEqual(plan.progressStats(store.getState()).learned, 1036);
assert.strictEqual(store.getSettings().dailyReviewLimit, 100);
console.log('Recovery release passed: 1036 pending words, high day 13 start, 100/day, migration, missed days, backup/write failures, idempotence and real app launch.');
