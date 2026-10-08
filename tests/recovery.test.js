const assert = require('assert');
const recovery = require('../utils/progress-recovery');
const plan = require('../utils/study-plan');
const { getWords } = require('../utils/words');
const { review, isStable } = require('../utils/scheduler');
const { DAY_MS, dayKey, startOfDay } = require('../utils/date');
const migrations = require('../utils/migrations');
const clone = value => JSON.parse(JSON.stringify(value));
const now = new Date(2026, 9, 8, 19).getTime();
const groups = recovery.checkpoints();
assert.strictEqual(groups.length, 51);
const high10 = groups.findIndex(group => group.category === 'high' && group.day === 10);
const fullCount = groups[high10].words.length;
const state = { schemaVersion: 3, createdAt: now, cards: {}, daily: {}, weakBook: {}, recentReviews: [], sentenceBook: { saved: { sentence: 'Saved sentence.' } } };
const settings = { dailyNewCount: 50, dailyReviewLimit: 80, dailyBacklogLimit: 30 };
const before = clone(state);
const summary = recovery.preview(state, high10, fullCount);
assert.strictEqual(summary.total, getWords().filter(word => word.category === 'core' || word.day <= 10).length);
const next = recovery.recover(state, high10, fullCount, now);
assert.deepStrictEqual(state, before, 'never mutate original records');
assert.strictEqual(plan.progressStats(next).learned, summary.total);
assert.strictEqual(plan.summarize(next, settings, now).unseen[0].id, 'h-11-1');
assert.strictEqual(plan.summarize(next, settings, now).scheduledDue.length, 50);
assert.strictEqual(plan.summarize(next, settings, now).stable, 0);
assert.strictEqual(Object.keys(next.daily).length, 0, 'no invented learning days');
assert.deepStrictEqual(next.recentReviews, [], 'no invented grades');
assert.deepStrictEqual(next.sentenceBook, state.sentenceBook);
const batches = {};
Object.values(next.cards).forEach(card => {
  assert.strictEqual(card.reps, 0);
  assert.strictEqual(card.lastAt, 0);
  assert.strictEqual(card.lastGrade, '');
  assert.strictEqual(isStable(card), false);
  const day = Math.floor((card.dueAt - startOfDay(now)) / DAY_MS);
  batches[day] = (batches[day] || 0) + 1;
});
assert.strictEqual(Object.keys(batches).length, summary.days);
assert.ok(Object.values(batches).every(count => count <= 50));
assert.deepStrictEqual(recovery.recover(next, high10, fullCount, now + DAY_MS), next, 'repeat recovery is idempotent');
assert.deepStrictEqual(migrations.migrateBackup({ type: 'mem-vocab-backup', formatVersion: 3, state: next }).state, next);
const partial = recovery.recover(state, high10, 17, now);
assert.strictEqual(plan.summarize(partial, settings, now).unseen[0].id, 'h-10-18');
const userCheckpoint = recovery.recover(state, high10, 0, now);
assert.strictEqual(plan.summarize(userCheckpoint, settings, now).unseen[0].id, 'h-10-1');
assert.strictEqual(plan.progressStats(userCheckpoint).learned, 886);
assert.strictEqual(recovery.preview(state, high10, 0).days, 18);
assert.throws(() => recovery.recover(state, high10, fullCount + 1), /invalid-checkpoint/);
assert.throws(() => recovery.recover(state, -1, 0), /invalid-checkpoint/);
assert.throws(() => recovery.recover(state, high10, NaN), /invalid-checkpoint/);
const existing = clone(state);
existing.cards['c-1-1'] = review(null, 'easy', now);
existing.daily[dayKey(now)] = { newDone: 1, newGoal: 50 };
existing.weakBook['c-1-1'] = { addedAt: now };
existing.recentReviews.push({ wordId: 'c-1-1', at: now, result: 'easy' });
const merged = recovery.recover(existing, high10, fullCount, now);
assert.deepStrictEqual(merged.cards['c-1-1'], existing.cards['c-1-1']);
assert.deepStrictEqual(merged.daily, existing.daily);
assert.deepStrictEqual(merged.weakBook, existing.weakBook);
assert.deepStrictEqual(merged.recentReviews, existing.recentReviews);

// Simulate actual review days: recovered batches do not overflow daily limits,
// and real answers replace unknown initial mastery without fake old grades.
const working = clone(next);
for (let day = 0; day < summary.days + 10; day += 1) {
  const time = now + day * DAY_MS;
  const session = plan.buildSession(working, settings, time);
  const reviews = session.queue.filter(item => item.phase === 'review');
  assert.ok(reviews.length <= 80);
  reviews.forEach(item => { working.cards[item.wordId] = review(working.cards[item.wordId], 'good', time); });
}
assert.ok(Object.values(working.cards).every(card => card.reps > 0));

let page, modal;
const values = {};
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync: (key, value) => { values[key] = clone(value); },
  removeStorageSync: key => { delete values[key]; },
  showModal: options => { modal = options; },
  showToast() {},
};
global.Page = definition => { page = definition; };
require('../pages/progress/index');
page.data = clone(page.data);
page.setData = data => Object.assign(page.data, data);
const store = require('../utils/store');
page.refresh();
assert.strictEqual(page.data.recoveryIndex, high10);
assert.strictEqual(page.data.recoveryCount, 0, 'user only started high day 10: resume from its first word');
assert.strictEqual(page.data.recoveryPreview.total, 886);
page.toggleRecovery();
assert.strictEqual(page.data.recoveryOpen, true);
page.onRecoveryCount({ detail: { value: '17' } });
const original = clone(store.getState());
store.saveSession({ queue: [{ wordId: 'c-1-1' }], index: 0 });
page.recoverProgress();
assert.deepStrictEqual(store.getState(), original, 'opening confirmation never writes progress');
modal.success({ confirm: false });
assert.deepStrictEqual(store.getState(), original);
page.recoverProgress();
modal.success({ confirm: true });
assert.strictEqual(plan.summarize(store.getState(), settings).unseen[0].id, 'h-10-18');
assert.strictEqual(store.getSession(), null, 'old initial task must be regenerated');
assert.ok(page.data.recoveryStatus.includes('并未恢复'));
console.log(`Progress recovery passed: ${summary.total} words through high day 10, ${summary.days} batches, merge, backup, partial checkpoints, real scheduling and confirmed UI.`);
