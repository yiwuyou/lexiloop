const assert = require('assert');
const scheduler = require('../utils/scheduler');
const plan = require('../utils/study-plan');
const mastery = require('../utils/mastery');
const { DAY_MS, startOfDay } = require('../utils/date');
const { getWords } = require('../utils/words');
const clone = value => JSON.parse(JSON.stringify(value));
const memory = {};
let page;
global.wx = {
  getStorageSync: key => memory[key] ? clone(memory[key]) : '',
  setStorageSync: (key, value) => { memory[key] = clone(value); },
  removeStorageSync: key => { delete memory[key]; },
  createInnerAudioContext: () => ({ onPlay() {}, onEnded() {}, onStop() {}, onError() {}, destroy() {} }),
  reLaunch() {},
};
global.Page = definition => { page = definition; };
require('../pages/study/index');
const store = require('../utils/store');
const realNow = Date.now;
let now = new Date(2026, 8, 7, 12).getTime();
Date.now = () => now;
page.setData = values => Object.assign(page.data, values);
function fresh(queue) {
  store.saveState({ schemaVersion: 3, cards: {}, daily: {}, weakBook: {}, recentReviews: [] });
  const session = plan.buildSession(store.getState(), { dailyNewCount: 1 }, now);
  session.queue = queue || session.queue.filter(item => item.phase !== 'context');
  store.saveSession(session);
  page.data.completed = false;
  page.onLoad({});
  return session;
}
function rate(grade) {
  page.revealAnswer();
  page.rate({ currentTarget: { dataset: { grade } } });
}
try {
  const session = fresh();
  const id = session.queue[0].wordId;
  rate('again');
  assert.strictEqual(page.data.completed, false);
  assert.strictEqual(page.data.waiting, true, 'last failed word cannot immediately reappear');
  page.onHide();
  now += 61000;
  page.onLoad({});
  rate('hard');
  assert.strictEqual(page.data.completed, false, 'second failure must not end the session');
  now += 61000;
  page.onShow();
  rate('good');
  assert.strictEqual(page.data.completed, true);
  const passed = store.getState().cards[id];
  assert.strictEqual(passed.needsRecall, false);
  assert.strictEqual(passed.dueAt, startOfDay(now) + DAY_MS);
  assert.strictEqual(store.getState().daily[session.day].newDone, 1, 'retries must not increase unique new count');
  assert.strictEqual(scheduler.review(passed, 'easy', now + 1000).dueAt, passed.dueAt);
  assert.ok(plan.summarize(store.getState(), { dailyNewCount: 1 }, startOfDay(now) + DAY_MS + 3600000).due.some(word => word.id === id));

  // Pending failures must survive a date change and a backup round trip.
  const failed = scheduler.review(passed, 'hard', now);
  const persisted = { schemaVersion: 3, cards: { [id]: failed }, daily: {}, weakBook: {}, recentReviews: [] };
  const restored = require('../utils/migrations').migrateState(clone(persisted));
  assert.ok(plan.buildSession(restored, { dailyNewCount: 0 }, now + DAY_MS).queue.some(item => item.wordId === id));
  const recovered = { queue: [{ wordId: id, phase: 'new' }], index: 1 };
  mastery.recover(recovered, restored.cards);
  assert.strictEqual(recovered.queue.length, 2);
  mastery.recover(recovered, restored.cards);
  assert.strictEqual(recovered.queue.length, 2, 'repeated recovery cannot duplicate pending work');

  const question = require('../data/context-questions')[0];
  const word = getWords().find(word => word.word.toLowerCase() === question.word.toLowerCase());
  fresh([{ wordId: word.id, phase: 'context', questionId: question.id }]);
  let state = store.getState();
  state.cards[word.id] = scheduler.review(null, 'good', now);
  store.saveState(state);
  page.chooseContext({ currentTarget: { dataset: { index: (question.answer + 1) % question.choices.length } } });
  page.nextContext();
  assert.strictEqual(page.data.completed, false);
  page.onHide();
  now += 61000;
  page.onLoad({});
  assert.notStrictEqual(page.data.question.answer, question.answer, 'retry changes answer position');
  page.chooseContext({ currentTarget: { dataset: { index: page.data.question.answer } } });
  page.onHide();
  page.onLoad({});
  assert.strictEqual(page.data.contextAnswered, true, 'explanation state survives restart');
  page.nextContext();
  assert.strictEqual(page.data.completed, true);
  assert.strictEqual(store.getState().cards[word.id].needsContext, '');
  assert.ok(store.getState().cards[word.id].dueAt <= startOfDay(now) + DAY_MS);
  let rects = [{ height: 600 }, { height: 320 }];
  wx.createSelectorQuery = () => ({
    in() { return this; }, select() { return this; }, boundingClientRect() { return this; },
    exec(callback) { callback(rects); },
  });
  page.data.completed = false;
  page.data.revealed = true;
  page.data.isContext = false;
  page.fitAnswerContent();
  assert.strictEqual(page.data.contentHeight, 320, 'short explanation leaves no filler gap before ratings');
  rects = [{ height: 600 }, { height: 950 }];
  page.fitAnswerContent();
  assert.strictEqual(page.data.contentHeight, 600, 'long explanation stays within space reserved above ratings');
  page.data.revealed = false;
  page.fitAnswerContent();
  assert.strictEqual(page.data.contentHeight, 600, 'answer sizing does not change unrevealed layout');
  console.log('Mastery, spacing, resume, context retries and content-dependent answer layout passed.');
} finally {
  clearTimeout(page.waitTimer);
  Date.now = realNow;
}
