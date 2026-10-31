const assert = require('assert');
const { getWords } = require('../utils/words');
const metrics = require('../utils/learning-metrics');
const order = require('../utils/study-order');
const plan = require('../utils/study-plan');
const mastery = require('../utils/mastery');
const clone = value => JSON.parse(JSON.stringify(value));
const day = '2026-10-30', now = Date.parse(day + 'T20:00:00+08:00');
const words = getWords(), old = words.slice(0, 100), fresh = words.slice(100, 150);
const taskPlan = Object.fromEntries(old.map(w => [w.id, 'review']).concat(fresh.map(w => [w.id, 'new'])));
const state = { cards: {}, daily: { [day]: { dueGoal: 100, newGoal: 50, dueDone: 100, newDone: 18, taskPlan } }, recentReviews: [] };
old.forEach((w, i) => { state.cards[w.id] = { seen: true, passedDay: day, needsRecall: i >= 67 && i < 74, dueAt: now + 86400000, fsrs: { stability: 7, difficulty: 5 } }; });
fresh.slice(0, 18).forEach(w => { state.cards[w.id] = { seen: true, passedDay: day, dueAt: now + 86400000 }; });
const prefix = old.map(w => ({ wordId: w.id, phase: 'review', answered: true })).concat(fresh.slice(0, 18).map(w => ({ wordId: w.id, phase: 'new', answered: true })));
const queue = prefix.concat(fresh.slice(18).map(w => ({ wordId: w.id, phase: 'new' })),
 old.slice(67, 74).map(w => ({ wordId: w.id, phase: 'reinforcement', availableAt: now + 60000 })),
 old.slice(74).map(w => ({ wordId: w.id, phase: 'sentence', questionId: 'original-' + w.id })));
const session = { day, index: prefix.length, queue, dueGoal: 100, newGoal: 50, dueDone: 100, newDone: 18, reviewPlanVersion: 2, contextPlanVersion: 3 };
const originalState = JSON.stringify(state), originalPrefix = JSON.stringify(prefix);
assert.strictEqual(plan.prepareSession(session, state, {}, now), true, 'upgrade a mixed session already partway through new words');
assert.strictEqual(JSON.stringify(session.queue.slice(0, session.index)), originalPrefix, 'do not replay or move answered history');
assert.strictEqual(JSON.stringify(state), originalState, 'do not reset grades, FSRS or existing counts');
assert.strictEqual(session.index, 118);
assert.ok(session.queue.slice(118, 151).every(item => taskPlan[item.wordId] === 'review'), 'all 7 old recalls and 26 old questions go before the remaining 32 new words');
assert.ok(session.queue.slice(151).every(item => taskPlan[item.wordId] === 'new'));
assert.strictEqual(session.queue.filter(item => item.questionId && item.questionId.startsWith('original-')).length, 26);
const summary = metrics.summary(state, session, day);
assert.strictEqual(summary.reviewPassed, 67); assert.strictEqual(summary.newPassed, 18);
assert.strictEqual(metrics.section(summary, 'review').total, 100); assert.strictEqual(metrics.section(summary, 'new').total, 50);
assert.strictEqual(summary.reviewPercent, 100);
assert.strictEqual(summary.reviewSeen, 100); assert.strictEqual(summary.reviewPending, 33); assert.strictEqual(summary.newPercent, 36);
const resumed = clone(session);
assert.strictEqual(plan.prepareSession(resumed, state, {}, now), false, 'reopening does not shuffle the same pending work again');
// A legacy delay must never let a ready new word bypass an old recall.
mastery.available(session, now); order.reconcile(session, state);
assert.strictEqual(order.kind(state, session, session.queue[session.index]), 'review');
// Recover an old failure absent from the remaining queue before considering new words.
const missing = clone(resumed);
missing.queue = missing.queue.filter((item, index) => index < missing.index || item.phase !== 'reinforcement');
order.reconcile(missing, state);
assert.strictEqual(missing.queue.filter((item, index) => index >= missing.index && item.phase === 'reinforcement').length, 7);
assert.strictEqual(metrics.summary(state, missing, day).total, 150);
// Already learned today is still today's new-word task, including its reinforcement.
const newId = fresh[0].id, newState = clone(state);
newState.cards[newId].needsRecall = true;
const newItem = { wordId: newId, phase: 'reinforcement' };
assert.strictEqual(order.kind(newState, resumed, newItem), 'new');
const practice = { mode: 'practice', queue: [{ wordId: newId, phase: 'practice' }], index: 0 };
assert.strictEqual(order.reconcile(practice, state), false);
assert.strictEqual(JSON.stringify(state), originalState);
console.log('Review-first resume: 67/100 old and 18/50 new, all old questions/retries first, original answers and FSRS intact, idempotent reopen passed.');
