const assert = require('assert/strict');
const clone = value => JSON.parse(JSON.stringify(value));
const values = {};
let failKey = '', failRemove = false, toast, page;
let writes = [], reads = [];
let now = Date.parse('2026-11-11T12:00:00+08:00');
const realNow = Date.now;
Date.now = () => now;
global.wx = {
  getStorageSync: key => { reads.push(key); return values[key] ? clone(values[key]) : ''; },
  setStorageSync(key, value) {
    if (key === failKey) throw Error('APP-SERVICE-SDK:setStorageSync:fail exceed storage max length');
    values[key] = clone(value);
    writes.push({ key, bytes: Buffer.byteLength(JSON.stringify(value)) });
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
  store.resumeCloudApply();
  store.saveSettings({ schemaVersion: 2, reviewLimitVersion: 1, examPlanVersion: 1, dailyNewCount: 2 });
  const state = store.getState(), settings = store.getSettings();
  const session = plan.buildSession(state, settings, now);
  store.saveState(state); store.saveSession(session);
  page.data.completed = false;
  page.onLoad({});
  return clone(session);
}
function grade(value) { page.revealAnswer(); page.rate({ currentTarget: { dataset: { grade: value } } }); }

function restart() {
  store.resumeCloudApply();
  page.onLoad({});
}
function assertRecovered(session) {
  assert.equal(page.session.index, 1);
  const reviews = store.getState().recentReviews;
  assert.equal(reviews.length, 1, 'restart must retain exactly one saved answer');
  assert.equal(reviews[0].wordId, session.queue[0].wordId);
  assert.equal(reviews[0].result, 'good');
  assert.equal(page.data.word.id, session.queue[1].wordId);
}
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
  restart();
  assertRecovered(session);

  for (const failed of ['mem_vocab_state_v1', 'mem_vocab_session_v1', 'remove-journal']) {
    session = fresh();
    grade('good');
    assert.equal(page.session.index, 1, 'a small durable answer can advance before full checkpoint');
    failKey = failed === 'remove-journal' ? '' : failed;
    failRemove = failed === 'remove-journal';
    assert.throws(() => store.flushAnswers());
    assert.ok(values.mem_vocab_answer_apply_v1, 'failed checkpoints retain the recovery journal');
    failKey = ''; failRemove = false;
    restart();
    assertRecovered(session);
    store.flushAnswers();
    restart();
    assertRecovered(session);
    assert.ok(!values.mem_vocab_answer_apply_v1, 'successful fold removes its journal');
  }

  session = fresh();
  // The prior release used a whole-answer journal. Keep upgrades recoverable.
  const legacyState = store.getState(), legacySession = clone(session);
  store.appendReview(legacyState, { wordId: session.queue[0].wordId, result: 'good', at: now, day: session.day });
  legacySession.index = 1;
  values.mem_vocab_answer_apply_v1 = { state: legacyState, session: legacySession };
  restart();
  assertRecovered(session);
  grade('easy');
  assert.equal(store.getState().recentReviews.length, 2);
  assert.equal(values.mem_vocab_answer_apply_v1.format, 2);
  restart();
  assert.equal(store.getState().recentReviews.length, 2);

  fresh();
  grade('hard');
  while (!page.data.isContext) grade('easy');
  const wordId = page.data.word.id;
  failKey = 'mem_vocab_answer_apply_v1';
  page.chooseContext({ currentTarget: { dataset: { index: page.data.question.answer } } });
  assert.equal(store.getState().recentReviews.filter(item => item.wordId === wordId && item.phase === 'sentence').length, 0);
  failKey = '';
  page.chooseContext({ currentTarget: { dataset: { index: page.data.question.answer } } });
  assert.equal(store.getState().recentReviews.filter(item => item.wordId === wordId && item.phase === 'sentence').length, 1);
  restart();
  assert.equal(page.data.contextAnswered, true, 'a restart retains the answered example explanation');
  const beforeIndex = page.session.index;
  failKey = 'mem_vocab_answer_apply_v1';
  page.nextContext();
  assert.equal(page.session.index, beforeIndex);
  failKey = '';
  page.nextContext();
  assert.equal(page.session.index, beforeIndex + 1);
  restart();
  assert.equal(page.session.index, beforeIndex + 1, 'saved example continuation is applied once');

  fresh();
  const practiceState = store.getState(), formalTask = store.getSession();
  const practiceTask = { mode: 'practice', queue: clone(formalTask.queue), index: 1 };
  practiceState.practice = { saved: { answers: 1 } };
  store.saveAnswer(practiceState, practiceTask, []);
  restart();
  assert.equal(store.getSession('practice').index, 1);
  assert.equal(store.getSession().index, formalTask.index, 'practice keeps the formal task separate');
  assert.equal(store.getState().practice.saved.answers, 1);
  store.flushAnswers();
  values.mem_vocab_answer_apply_v1 = { format: 2, changes: [{ path: ['state', 'cards', '__proto__'], after: {} }], extras: [] };
  store.resumeCloudApply();
  assert.throws(() => store.getState(), /invalid-path/);
  assert.throws(() => store.getState(), /invalid-path/, 'a second read must not bypass a damaged pending answer');
  delete values.mem_vocab_answer_apply_v1; store.resumeCloudApply();
  fresh();
  const words = require('../utils/words').getWords(), scheduler = require('../utils/scheduler');
  const large = store.getState();
  words.slice(0, 1600).forEach(word => {
    large.cards[word.id] = Object.assign(scheduler.review(null, 'good', now - 7 * 86400000), { dueAt: now - 1000 });
  });
  large.recentReviews = Array.from({ length: 3000 }, (_, i) => ({
    id: 'history-' + i, wordId: words[i % 1600].id, at: now - (3000 - i) * 1000,
    day: '2026-11-10', phase: 'review', result: 'good', scheduler: 'fsrs-6',
    note: 'Historic review metadata retained for migration and memory analysis.'
  }));
  large.privateExtension = { retained: true };
  const largeSession = plan.buildSession(large, store.getSettings(), now);
  store.saveState(large); store.saveSession(largeSession); page.onLoad({});
  const archiveBytes = Buffer.byteLength(JSON.stringify(store.getState()));
  assert.ok(archiveBytes > 800000);
  const cloud = require('../utils/cloud-sync');
  wx.cloud = { init() {}, callFunction() { throw Error('isolated test must not call a live cloud'); } };
  require('../utils/sync-storage').write('lexiloop_cloud_sync_v1', {
    device: 'test-device', enabled: true, seq: 0, rev: 1, outbox: [], observed: store.bundle(),
    fieldChangesVersion: 1, owner: { device: 'test-device', epoch: 1 }, resourceRetryAt: now + 3600000,
  });
  cloud.start(); cloud.capture();
  reads = []; writes = [];
  const begin = performance.now();
  for (let i = 0; i < 10; i++) { grade('good'); cloud.capture(); }
  const elapsed = performance.now() - begin;
  assert.equal(page.session.index, 10);
  assert.equal(writes.filter(item => item.key === 'mem_vocab_answer_apply_v1').length, 10, 'each real page rating needs only one durable small answer write');
  assert.equal(writes.filter(item => item.key === 'lexiloop_cloud_sync_v1').length, 10, 'post-rating sync capture adds only one small metadata write');
  assert.ok(writes.every(item => ['mem_vocab_answer_apply_v1', 'lexiloop_cloud_sync_v1'].includes(item.key) && item.bytes < 48000), 'ratings never write the complete archive or full task');
  assert.ok(!reads.includes('mem_vocab_state_v1'), 'ratings do not re-read and decompress the archive');
  const after = store.getState();
  assert.equal(after.recentReviews.length, 3000);
  restart();
  assert.equal(page.session.index, 10);
  assert.ok(require('../utils/sync-model').equal(store.getState(), after), 'all ten answers, daily counters and extra metadata survive restart');
  const smallWrites = writes.slice();
  store.clearSession();
  assert.equal(store.getSession(), null, 'clearing a task also invalidates its working image');
  console.log('Actual study page: durable delta/failure/restart/legacy recovery and example continuation passed.');
  console.log(JSON.stringify({ archiveBytes, ratings: 10, writes: smallWrites.length, maxWriteBytes: Math.max(...smallWrites.map(item => item.bytes)), meanRatingAndSyncMs: Math.round(elapsed / 10 * 10) / 10 }));
} finally {
  failKey = ''; failRemove = false;
  require('../utils/cloud-sync').dispose();
  clock.pause();
  Date.now = realNow;
}
