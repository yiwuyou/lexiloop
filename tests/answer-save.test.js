const assert = require('assert/strict');
const clone = value => JSON.parse(JSON.stringify(value));
const values = {};
let failKey = '', failRemove = false, toast, page;
let now = Date.parse('2026-11-11T12:00:00+08:00');
const realNow = Date.now;
Date.now = () => now;
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync(key, value) {
    if (key === failKey) throw Error('APP-SERVICE-SDK:setStorageSync:fail exceed storage max length');
    values[key] = clone(value);
  },
  removeStorageSync(key) {
    if (failRemove && key === 'mem_vocab_answer_apply_v1') throw Error('injected-remove-failure');
    delete values[key];
  },
  showToast: value => { toast = value; },
  createInnerAudioContext: () => ({ onPlay() {}, onEnded() {}, onStop() {}, onError() {}, stop() {}, destroy() {} }),
  reLaunch() {},
};
global.Page = definition => { page = definition; };
const store = require('../utils/store'), plan = require('../utils/study-plan');
const clock = require('../utils/learning-clock');
require('../pages/study/index');
page.data = clone(page.data);
page.setData = function (patch, callback) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.');
    let target = this.data;
    parts.slice(0, -1).forEach(part => { target = target[part]; });
    target[parts[parts.length - 1]] = value;
  });
  if (callback) callback();
};
function fresh() {
  failKey = ''; failRemove = false; clock.pause();
  Object.keys(values).forEach(key => delete values[key]);
  store.saveSettings({ schemaVersion: 2, reviewLimitVersion: 1, examPlanVersion: 1, dailyNewCount: 2 });
  const state = store.getState(), settings = store.getSettings();
  const session = plan.buildSession(state, settings, now);
  store.saveState(state); store.saveSession(session);
  page.data.completed = false;
  page.onLoad({});
  return clone(session);
}
function grade(value) { page.revealAnswer(); page.rate({ currentTarget: { dataset: { grade: value } } }); }

try {
  let session = fresh();
  failKey = 'mem_vocab_answer_apply_v1';
  grade('good');
  assert.equal(page.session.index, 0, 'an undurable answer cannot advance the live queue');
  assert.equal(store.getState().recentReviews.length, 0);
  assert.equal(page.data.word.id, session.queue[0].wordId);
  assert.ok(toast.title.includes('存储'));
  failKey = '';
  grade('good');
  assert.equal(store.getState().recentReviews.length, 1);
  assert.equal(page.session.index, 1);

  session = fresh();
  failKey = 'mem_vocab_state_v1';
  grade('good');
  assert.ok(values.mem_vocab_answer_apply_v1, 'answer and task image are durable before either study key changes');
  assert.equal(values.mem_vocab_state_v1.recentReviews.length, 0);
  failKey = '';
  page.rate({ currentTarget: { dataset: { grade: 'again' } } });
  assert.equal(store.getState().recentReviews.length, 1, 'the retry completes the existing save once');
  assert.equal(store.getState().recentReviews[0].wordId, session.queue[0].wordId);
  assert.equal(store.getState().recentReviews[0].result, 'good');
  assert.equal(page.data.word.id, session.queue[1].wordId, 'recovered screen shows the next word before accepting another grade');
  assert.equal(page.session.index, 1);

  session = fresh();
  failKey = 'mem_vocab_session_v1';
  grade('good');
  assert.equal(values.mem_vocab_state_v1.recentReviews.length, 1);
  assert.ok(values.mem_vocab_answer_apply_v1);
  failKey = '';
  page.onLoad({});
  assert.equal(page.session.index, 1, 'restart completes the interrupted task write');
  assert.equal(store.getState().recentReviews.length, 1);
  assert.equal(page.data.word.id, session.queue[1].wordId);

  fresh();
  failRemove = true;
  grade('good');
  failRemove = false;
  page.rate({ currentTarget: { dataset: { grade: 'hard' } } });
  assert.equal(store.getState().recentReviews.length, 1, 'interrupted journal removal is idempotent');
  assert.equal(page.session.index, 1);

  fresh();
  grade('hard');
  while (!page.data.isContext) grade('easy');
  const wordId = page.data.word.id;
  failKey = 'mem_vocab_state_v1';
  page.chooseContext({ currentTarget: { dataset: { index: page.data.question.answer } } });
  failKey = '';
  page.chooseContext({ currentTarget: { dataset: { index: page.data.question.answer } } });
  assert.equal(store.getState().recentReviews.filter(item => item.wordId === wordId && item.phase === 'sentence').length, 1);
  assert.equal(page.data.contextAnswered, true, 'example answer recovers its explanation screen');
  const beforeIndex = page.session.index;
  failKey = 'mem_vocab_session_v1';
  page.nextContext();
  failKey = '';
  page.nextContext();
  assert.equal(page.session.index, beforeIndex + 1, 'continuing after an interrupted save advances only once');
  assert.ok(!values.mem_vocab_answer_apply_v1);
  console.log('Actual study page: journal/state/session/removal failures, visible-card recovery, single answers and sentence continuation passed.');
} finally {
  failKey = ''; failRemove = false;
  clock.pause();
  Date.now = realNow;
}
