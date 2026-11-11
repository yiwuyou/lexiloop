const assert = require('assert/strict');
const { getWords, getWord, getSourceWords } = require('../utils/words');
const identity = require('../utils/word-identity');
const migrations = require('../utils/migrations');
const model = require('../utils/sync-model');
const context = require('../utils/context');
const plan = require('../utils/study-plan');
const clone = value => JSON.parse(JSON.stringify(value));
const all = getWords(), originals = getSourceWords();
assert.equal(originals.length, 2522);
assert.equal(all.length, 2514);
assert.equal(new Set(all.map(word => word.spokenWord.toLowerCase())).size, all.length);
const groups = new Map();
originals.forEach(word => {
  const key = word.spokenWord.toLowerCase();
  groups.set(key, (groups.get(key) || []).concat(word));
});
assert.equal([...groups.values()].filter(rows => rows.length > 1).length, 7);
groups.forEach(rows => {
  const active = getWord(rows[0].id);
  assert.equal(active.id, rows[0].id, 'keep the first source occurrence in learning order');
  const meanings = [...new Set(rows.flatMap(word => word.meaning.split(/[；;]/)).map(value => value.trim()))];
  assert.equal(active.meaning, rows.length > 1 ? meanings.join('；') : rows[0].meaning);
  rows.forEach(word => assert.equal(getWord(word.id), active, 'old links open the same merged card'));
});
assert.equal(getWord('h-9-31').meaning, '缺陷；缺点；叛变；背叛');
assert.ok(getWord('c-9-27').meaning.includes('愿景'));
assert.ok(getWord('h-13-18').searchText.includes('inquire'));
assert.equal(context.getById('recall-c-3-5').answer,
  context.getRecallQuestion(originals.find(word => word.id === 'c-3-5')).answer,
  'an old open question retains its answer position');

const day = '2026-11-11';
const earlier = { seen: true, reps: 8, lastAt: 100, dueAt: 200, interval: 5, fsrs: { stability: 3 }, needsRecall: true };
const latest = { seen: true, reps: 2, lastAt: 300, dueAt: 600, interval: 1, fsrs: { stability: 2 }, passedDay: day };
const raw = {
  schemaVersion: 3,
  cards: { 'c-1-20': earlier, 'c-3-5': latest, 'h-9-31': { seen: true, reps: 0, lastAt: 500, recoveredAt: 400 } },
  weakBook: { 'h-9-31': { addedAt: 20, source: 'manual' } },
  daily: { [day]: {
    taskPlan: { 'c-1-20': 'review', 'c-3-5': 'review' },
    firstAnswers: { 'c-1-20': 'review', 'c-3-5': 'review' },
    firstOverdue: { 'c-1-20': true, 'c-3-5': true },
    taskStatus: { 'c-1-20': { at: 100, passed: false }, 'c-3-5': { at: 300, passed: true } },
    dueGoal: 2, dueDone: 2, backlogDone: 2, minutes: 15,
  } },
  recentReviews: [
    { id: 'real-1', wordId: 'c-1-20', phase: 'review', result: 'hard', at: 100, day },
    { id: 'real-2', wordId: 'c-3-5', phase: 'review', result: 'good', at: 300, day },
  ],
  sentenceBook: { example: { wordId: 'h-9-31', sentence: 'A design defect.', translation: '设计缺陷', addedAt: 400 } },
};
const before = clone(raw);
const merged = identity.mergeState(raw);
assert.deepEqual(raw, before, 'migration leaves its source available for rollback');
assert.deepEqual(merged.cards, { 'c-1-20': latest }, 'take the latest complete actual card, without combining model fields');
assert.ok(merged.weakBook['c-1-20']);
assert.equal(merged.sentenceBook.example.wordId, 'c-1-20');
assert.equal(merged.recentReviews.length, 2, 'preserve both real answers');
assert.deepEqual(merged.recentReviews.map(item => item.id), ['real-1', 'real-2']);
assert.equal(merged.daily[day].dueGoal, 1);
assert.equal(merged.daily[day].dueDone, 1);
assert.equal(merged.daily[day].backlogDone, 1);
assert.equal(merged.daily[day].minutes, 15);
assert.equal(identity.mergeState(merged), merged, 'migration is idempotent');

const saved = { day, index: 1, dueGoal: 2, dueDone: 1, newGoal: 0, queue: [
  { wordId: 'c-1-20', phase: 'review' },
  { wordId: 'c-3-5', phase: 'review' },
  { wordId: 'c-3-5', phase: 'sentence', questionId: 'recall-c-3-5', answered: true, correct: false, selectedChoice: 2 },
  { wordId: 'c-3-5', phase: 'reinforcement' },
] };
const resumed = identity.mergeSession(saved);
assert.equal(resumed.index, saved.index);
assert.equal(resumed.dueGoal, 1);
assert.equal(resumed.queue.filter(item => item.phase === 'review').length, 1);
assert.equal(resumed.queue[1].questionId, 'recall-c-3-5');
assert.equal(resumed.queue[1].selectedChoice, 2);
assert.equal(resumed.queue[1].correct, false);
assert.ok(resumed.queue.every(item => item.wordId === 'c-1-20'));
assert.equal(identity.mergeSession(resumed), resumed);
const newSession = plan.buildSession(merged, { dailyReviewLimit: 100, dailyNewCount: 50 }, Date.parse(day+'T12:00:00+08:00'));
assert.equal(newSession.queue.filter(item => item.wordId === 'c-1-20' && item.phase === 'new').length, 0);

const carryState = clone(raw);
carryState.daily[day].carryTasks = {
  'c-1-20:sentence:recall-c-1-20': { at: 100, item: { wordId: 'c-1-20', phase: 'sentence', questionId: 'recall-c-1-20' } },
  'c-3-5:sentence:recall-c-3-5': { at: 300, item: { wordId: 'c-3-5', phase: 'sentence', questionId: 'recall-c-3-5' } },
};
const carryMerged = identity.mergeState(carryState);
assert.equal(Object.keys(carryMerged.daily[day].carryTasks).length, 1, 'carry duplicate example tasks only once');
assert.equal(Object.values(carryMerged.daily[day].carryTasks)[0].item.questionId, 'recall-c-3-5', 'retain the selected original question');
const pendingState = clone(merged);
pendingState.cards['c-1-20'].needsRecall = true;
const pending = identity.mergeSession({ day, index: 1, dueGoal: 2, newGoal: 0, reviewPlanVersion: 2, contextPlanVersion: 3, questionOrderVersion: 1,
  queue: [{ wordId: 'c-1-20', phase: 'review' }, { wordId: 'c-3-5', phase: 'review' }] });
plan.prepareSession(pending, pendingState, { dailyNewCount: 0 }, Date.parse(day+'T12:00:00+08:00'));
assert.ok(pending.queue.slice(pending.index).some(item => item.wordId === 'c-1-20' && item.phase === 'reinforcement'),
  'removing a duplicate base card cannot hide an unfinished recall');

const values = {
  mem_vocab_state_v1: clone(raw),
  mem_vocab_session_v1: clone(saved),
  mem_vocab_settings_v1: { schemaVersion: 2, reviewLimitVersion: 1, examPlanVersion: 1 },
};
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync: (key, value) => { values[key] = clone(value); },
  removeStorageSync: key => { delete values[key]; },
};
const store = require('../utils/store');
assert.deepEqual(store.getState().cards, merged.cards);
assert.deepEqual(require('../utils/sync-storage').read('mem_vocab_before_word_merge_v1').state, raw);
assert.deepEqual(store.getSession(), resumed);
const writeCount = Object.keys(values).length;
store.getState();
assert.equal(Object.keys(values).length, writeCount, 'reopening does not produce another migration backup');
const settings = store.getSettings();
const remote = { state: clone(raw), settings, session: clone(saved), practiceSession: null };
const normalized = { state: merged, settings, session: resumed, practiceSession: null };
model.apply(remote, { changes: model.diff(remote, normalized), seq: 1, device: 'test', baseRev: 1 }, {});
const hydrated = migrations.migrateState(remote.state);
assert.deepEqual(hydrated.cards, merged.cards, 'existing sync peers converge on the same complete card');
for (const field of ['dueGoal', 'dueDone', 'backlogDone', 'minutes']) assert.equal(hydrated.daily[day][field], merged.daily[day][field]);
assert.equal(identity.mergeState(hydrated), hydrated, 'repeated cloud hydration cannot subtract duplicate counts twice');
const fineRemote = { state: clone(raw), settings, session: clone(saved), practiceSession: null };
model.apply(fineRemote, { changes: model.fineDiff(fineRemote, normalized), seq: 1, device: 'test', baseRev: 1 }, {});
const fineHydrated = migrations.migrateState(fineRemote.state);
assert.deepEqual(fineHydrated.cards, merged.cards);
for (const field of ['dueGoal', 'dueDone', 'backlogDone']) assert.equal(fineHydrated.daily[day][field], merged.daily[day][field]);
store.replaceBundle({ state: raw, settings, session: saved, practiceSession: null });
assert.deepEqual(store.getState(), merged);
assert.deepEqual(store.getSession(), resumed);
let page;
global.Page = definition => { page = definition; };
require('../word-detail/search');
page.setData = update => Object.assign(page.data, update);
page.search({ detail: { value: 'defect' } });
assert.equal(page.data.total, 1);
assert.equal(page.data.rows[0].meaning, '缺陷；缺点；叛变；背叛');
page.search({ detail: { value: 'inquire' } });
assert.equal(page.data.total, 1);
page.search({ detail: { value: 'endeavour' } });
assert.equal(page.data.total, 1);
console.log('Duplicate union: seven groups, source aliases, latest actual models, backup, old questions, unique tasks, sync hydration and real search passed.');
