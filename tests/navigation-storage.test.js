const assert = require('assert/strict');
const clone = value => JSON.parse(JSON.stringify(value)), values = {}, events = [], timers = new Map();
let definition, failKey = '', navigation, toast, now = Date.parse('2026-11-12T19:00:00+08:00'), seq = 0;
const realNow = Date.now, realSet = global.setTimeout, realClear = global.clearTimeout;
Date.now = () => now;
global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; };
global.clearTimeout = id => timers.delete(id);
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync(key, value) { if (key === failKey) throw Error('disk full'); values[key] = clone(value); events.push({ op: 'write', key }); },
  removeStorageSync: key => delete values[key],
  showToast: value => { toast = value; },
  switchTab: value => { navigation = value; events.push({ op: 'navigate' }); },
  navigateBack: value => { events.push({ op: 'back' }); },
  createInnerAudioContext: () => ({ onPlay() {}, onEnded() {}, onStop() {}, onError() {}, stop() {}, destroy() {} }),
  setClipboardData: value => { events.push({ op: 'copy', value: value.data }); },
};
global.Page = value => { definition = value; };
const store = require('../utils/store'), clock = require('../utils/learning-clock'), cloud = require('../utils/cloud-sync');
const plan = require('../utils/study-plan'), scheduler = require('../utils/scheduler'), words = require('../utils/words').getWords();
function instance(source) {
  const page = Object.assign({}, source, { data: clone(source.data) });
  page.setData = function(patch, callback) { Object.entries(patch).forEach(([key, value]) => {
    const keys = key.split('.'); let target = this.data; keys.slice(0,-1).forEach(k => target = target[k]); target[keys[keys.length-1]] = value;
  }); if (callback) callback(); };
  return page;
}
const originalFlush = cloud.flush;
cloud.flush = () => { events.push({ op: 'cloud-flush' }); return Promise.resolve(true); };
try {
  const state = store.getState();
  words.slice(0, 1600).forEach(word => { state.cards[word.id] = Object.assign(scheduler.review(null, 'good', now - 7*86400000), { dueAt: now - 1 }); });
  store.saveState(state); store.saveSession(plan.buildSession(state, store.getSettings(), now));
  require('../pages/study/index');
  const study = instance(definition); study.onLoad({}); study.onShow();
  study.revealAnswer(); study.rate({ currentTarget: { dataset: { grade: 'again' } } });
  const answers = store.getState().recentReviews.length;
  // A periodic checkpoint cannot compress the archive while learning is active.
  events.length = 0;
  const checkpoint = Array.from(timers.values()).find(timer => timer.ms === 30000);
  assert.ok(checkpoint); checkpoint.fn();
  assert.equal(events.length, 0);
  // Detail -> learning also retains the cache and does not checkpoint the archive.
  study.onHide();
  require('../word-detail/index'); const detail = instance(definition);
  detail.onLoad({ id: words[0].id }); detail.onShow(); now += 4000; events.length = 0;
  detail.goBack(); detail.onHide(); detail.onUnload(); study.onShow();
  assert.ok(events.some(item => item.op === 'back'));
  assert.ok(events.filter(item => item.op === 'write').every(item => item.key === 'mem_vocab_answer_apply_v1'));
  assert.equal(store.getState().recentReviews.length, answers);
  // A failed small return write keeps the current screen and permits a retry.
  now += 4000; events.length = 0; failKey = 'mem_vocab_answer_apply_v1';
  study.exitStudy();
  assert.ok(!events.some(item => item.op === 'navigate'));
  assert.equal(study.returning, false); assert.ok(toast.title.includes('保存'));
  failKey = ''; events.length = 0;
  study.exitStudy(); study.onHide(); study.onUnload();
  assert.equal(events.filter(item => item.op === 'navigate').length, 1);
  assert.ok(events.filter(item => item.op === 'write').every(item => item.key === 'mem_vocab_answer_apply_v1'));
  assert.ok(!events.some(item => item.op === 'cloud-flush'), 'return does not synchronously prepare a cloud request');
  navigation.success();
  const deferred = Array.from(timers.values()).find(timer => timer.ms === 500); assert.ok(deferred); deferred.fn();
  assert.equal(events[events.length-1].op, 'cloud-flush');
  store.resumeCloudApply(); assert.equal(store.getState().recentReviews.length, answers);
  // Unexpected damaged storage produces a retry/copy panel instead of a blank home.
  values.mem_vocab_answer_apply_v1 = { format: 2, changes: [{ path: ['state', 'cards', '__proto__'], after: {} }], extras: [] };
  store.resumeCloudApply(); study.studyHidden = false;
  assert.doesNotThrow(() => study.onHide(), 'a failed lifecycle save cannot abort navigation');
  require('../pages/today/index'); const today = instance(definition);
  today.refresh(); assert.ok(today.data.restoreError); today.copyRestoreDiagnostic();
  const copied = events[events.length-1].value;
  assert.ok(copied.includes('A0') && copied.includes('invalid-path'));
  delete values.mem_vocab_answer_apply_v1; today.retryRestore(); assert.equal(today.data.restoreError, '');
  console.log('Navigation: active checkpoint deferral, detail round-trip, one small return save, failed-save retry, deferred sync and readable error recovery passed.');
} finally {
  failKey = ''; cloud.flush = originalFlush; cloud.dispose(); clock.pause();
  Date.now = realNow; global.setTimeout = realSet; global.clearTimeout = realClear;
}
