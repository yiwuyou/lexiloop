const assert = require('assert');
const recovery = require('../utils/progress-recovery');
const plan = require('../utils/study-plan');
const { getWords } = require('../utils/words');
const { review, isStable } = require('../utils/scheduler');
const { DAY_MS, dayKey, startOfDay } = require('../utils/date');
const migrations = require('../utils/migrations');
const practice = require('../utils/practice');
const fs = require('fs');
const path = require('path');
const clone = value => JSON.parse(JSON.stringify(value));
const now = new Date(2026, 9, 8, 19).getTime();
const groups = recovery.checkpoints();
assert.strictEqual(groups.length, 51);
const high10 = groups.findIndex(group => group.category === 'high' && group.day === 10);
const fullCount = groups[high10].words.length;
const state = { schemaVersion: 3, createdAt: now, cards: {}, daily: {}, weakBook: {}, recentReviews: [], sentenceBook: { saved: { sentence: 'Saved sentence.' } } };
const settings = { dailyNewCount: 50, dailyReviewLimit: 100, dailyBacklogLimit: 30 };
const before = clone(state);
const summary = recovery.preview(state, high10, fullCount);
assert.strictEqual(summary.total, getWords().filter(word => word.category === 'core' || word.day <= 10).length);
const next = recovery.recover(state, high10, fullCount, now);
assert.deepStrictEqual(state, before, 'never mutate original records');
assert.strictEqual(plan.progressStats(next).learned, summary.total);
assert.strictEqual(plan.summarize(next, settings, now).unseen[0].id, 'h-11-1');
assert.strictEqual(plan.summarize(next, settings, now).scheduledDue.length, 100);
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
assert.ok(Object.values(batches).every(count => count <= 100));
assert.deepStrictEqual(recovery.recover(next, high10, fullCount, now + DAY_MS), next, 'repeat recovery is idempotent');
assert.deepStrictEqual(migrations.migrateBackup({ type: 'mem-vocab-backup', formatVersion: 3, state: next }).state, next);
const partial = recovery.recover(state, high10, 17, now);
assert.strictEqual(plan.summarize(partial, settings, now).unseen[0].id, 'h-10-18');
const userCheckpoint = recovery.recover(state, high10, 0, now);
assert.strictEqual(plan.summarize(userCheckpoint, settings, now).unseen[0].id, 'h-10-1');
assert.strictEqual(plan.progressStats(userCheckpoint).learned, 886);
assert.strictEqual(recovery.preview(state, high10, 0).days, 9);
const pendingStats = plan.summarize(userCheckpoint, settings, now);
assert.strictEqual(pendingStats.remainingReviewCount, 886, 'future recovered words must remain visible');
assert.strictEqual(pendingStats.deferredRecoveryCount, 786);
assert.strictEqual(pendingStats.due.length, 100, 'recovery batches use the requested 100-word target');
assert.strictEqual(pendingStats.scheduledDue.length, 100);
const reviewedToday = clone(userCheckpoint);
pendingStats.due.forEach(word => { reviewedToday.cards[word.id] = review(reviewedToday.cards[word.id], 'good', now); });
assert.strictEqual(plan.summarize(reviewedToday, settings, now).remainingReviewCount, 786);
assert.strictEqual(plan.summarize(reviewedToday, settings, now).due.length, 0);
assert.strictEqual(practice.buildSession(reviewedToday, { scope: 'due' }, now).queue.length, 50,
  'voluntary practice must offer deferred recovered words even after today is done');
const thirdDay = plan.summarize(userCheckpoint, settings, now + 2 * DAY_MS);
assert.strictEqual(thirdDay.remainingReviewCount, 886, 'due recovered words must not count twice');
assert.strictEqual(thirdDay.deferredRecoveryCount, 586);
assert.strictEqual(thirdDay.scheduledDue.length, 100, 'unverified overdue batches must not be capped at 30');
assert.strictEqual(thirdDay.scheduledBacklogCount, 0);
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
  assert.ok(reviews.length <= 100);
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
assert.strictEqual(groups[page.data.recoveryIndex].day, 13);
assert.strictEqual(groups[page.data.recoveryIndex].category, 'high');
assert.strictEqual(page.data.recoveryCount, 0, 'current recovery checkpoint resumes at the start of high day 13');
assert.strictEqual(page.data.recoveryPreview.total, 1036);
page.onRecoveryDay({ detail: { value: String(high10) } });
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
// Existing v0.5.16 recovered data must display correctly without running
// recovery a second time, and every tab must agree on the checkpoint.
store.saveState(recovery.recover(state, high10, 0, Date.now()));
require('../pages/today/index');
page.data = clone(page.data);
page.setData = data => Object.assign(page.data, data);
page.refresh();
assert.strictEqual(page.data.remainingDueCount, 886);
assert.strictEqual(page.data.currentDueCount, 100);
assert.strictEqual(page.data.deferredRecoveryCount, 786);
assert.strictEqual(page.data.todayReviewGoal, 100);
assert.strictEqual(page.data.todayReviewDone, 0);
assert.strictEqual(page.data.sourceTag, '高频 day 10');
wx.createInnerAudioContext = () => ({ onPlay() {}, onEnded() {}, onStop() {}, onError() {} });
require('../pages/library/index');
page.data = clone(page.data);
page.setData = data => Object.assign(page.data, data);
page.onLoad();
assert.strictEqual(page.data.dayGroups.filter(group => group.learned === group.total).length, 18);
assert.strictEqual(page.data.dayGroups.find(group => group.key === 'high-10').learned, 0);
const template = fs.readFileSync(path.join(__dirname, '../pages/progress/index.wxml'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../pages/progress/index.wxss'), 'utf8');
assert.ok(/<view class="backup-result" wx:if="\{\{recoveryStatus\}\}"><text>/.test(template),
  'recovery success message needs a block wrapper, never a styled inline text');
assert.ok(/\.backup-result text\s*\{[^}]*display:\s*block/.test(styles));
console.log(`Progress recovery passed: ${summary.total} words through high day 10, ${summary.days} batches, merge, backup, partial checkpoints, real scheduling and confirmed UI.`);
