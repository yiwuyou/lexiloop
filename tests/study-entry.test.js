const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const now = Date.parse('2026-11-05T15:00:00+08:00');
class ClockDate extends Date { static now() { return now; } }

let asyncLoads = 0;
const requireScheduler = name => require(path.resolve(root, 'utils', name));
requireScheduler.async = () => { asyncLoads++; return new Promise(() => {}); };
const schedulerModule = { exports: {} };
vm.runInNewContext(source('utils/scheduler.js'), { module: schedulerModule, require: requireScheduler, Date: ClockDate });
const scheduler = schedulerModule.exports;

function entry(beginStudy, seed = {}) {
  let page, session = clone(seed.session || null);
  let state = clone(seed.state || { schemaVersion: 3, cards: {}, daily: {}, weakBook: {}, recentReviews: [] });
  const calls = { handoffs: 0, navigation: [], failOpen: false, failSave: false, saved: 0 };
  const store = { getState: () => clone(state), getSession: () => clone(session),
    getSettings: () => ({ dailyReviewLimit: 100, dailyNewCount: 50 }),
    saveSession(value) { if (calls.failSave) throw Error('storage write failed'); session = clone(value); calls.saved++; },
    saveState(value) { state = clone(value); },
  };
  const cloud = { beginStudy() { calls.handoffs++; return beginStudy(); } };
  const requirePage = name => {
    if (name.endsWith('/scheduler')) return scheduler;
    if (name.endsWith('/store')) return store;
    if (name.endsWith('/cloud-sync')) return cloud;
    return require(path.resolve(root, 'pages/today', name));
  };
  const wx = { showToast() {}, setClipboardData({ data }) { calls.clipboard = data; }, navigateTo(options) {
    calls.navigation.push(options.url);
    if (calls.failOpen) options.fail({ errMsg: 'navigateTo:fail' }); else options.success();
  } };
  vm.runInNewContext(source('pages/today/index.js'), { Page: definition => { page = definition; }, require: requirePage, wx, Date: ClockDate, console: { warn() {} } });
  page.setData = patch => Object.assign(page.data, patch);
  return { page, calls, store };
}

async function main() {
  const warmup = scheduler.prepare(); await tick();
  assert.strictEqual(asyncLoads, 0, 'opening study must not depend on an async loader that never returns on desktop');
  await warmup;
  assert.strictEqual(scheduler.review(null, 'good', now).fsrsVersion, 'FSRS-6/ts-fsrs-5.4.1');

  let finishHandoff;
  const pending = new Promise(resolve => { finishHandoff = resolve; });
  const normal = entry(() => pending);
  const start = normal.page.startStudy();
  assert.match(normal.page.data.studyStartLabel, /准备/);
  await tick();
  assert.match(normal.page.data.studyStartLabel, /接续/);
  await normal.page.startStudy();
  assert.strictEqual(normal.calls.handoffs, 1);
  assert.strictEqual(normal.calls.saved, 0);
  finishHandoff(true); await start;
  assert.deepStrictEqual(normal.calls.navigation, ['/pages/study/index']);
  assert.strictEqual(normal.store.getSession().queue.length, 50);
  assert.strictEqual(normal.page.data.studyStartLabel, '');

  // A device may start a new day with only yesterday's synced records.
  const yesterday = '2026-11-04', today = '2026-11-05';
  const word = require('../utils/words').getWords()[0];
  const prior = { wordId: word.id, phase: 'review', day: yesterday, at: now - 86400000, grade: 'hard' };
  const priorDay = { dueDone: 1, time: { segments: { review: { start: prior.at, end: prior.at + 45000, phase: 'review' } } } };
  const seed = { state: { schemaVersion: 3, cards: { [word.id]: { seen: true, dueAt: now, needsRecall: true } },
    daily: { [yesterday]: priorDay }, weakBook: {}, recentReviews: [prior] } };
  const withCarry = Object.assign({}, seed, { session: { day: yesterday, index: 1,
    queue: [{ wordId: word.id, phase: 'review' }, { wordId: word.id, phase: 'sentence', questionId: 'pending-sentence' }] } });
  for (const input of [seed, withCarry]) {
    const next = entry(async () => true, input);
    await next.page.startStudy();
    assert.deepStrictEqual(next.calls.navigation, ['/pages/study/index']);
    const task = next.store.getSession(), state = next.store.getState();
    assert.deepStrictEqual([task.day, task.dueGoal, task.newGoal, task.dueDone, task.newDone], [today, 1, 50, 0, 0]);
    assert.equal(task.queue[0].wordId, word.id);
    assert.deepStrictEqual(state.recentReviews, [prior]);
    assert.deepStrictEqual(state.daily[yesterday].time, priorDay.time);
    assert.ok(state.daily[today].initialEstimate.seconds > 0);
    if (input.session) assert.ok(task.queue.some(item => item.questionId === 'pending-sentence'));
  }

  const blocked = entry(async () => false);
  await blocked.page.startStudy();
  assert.match(blocked.page.data.studyStartError, /查看同步状态/);
  assert.strictEqual(blocked.calls.saved, 0, 'failed handoff never overwrites a local task');
  assert.strictEqual(blocked.calls.navigation.length, 0);

  const retry = entry(async () => true);
  retry.calls.failSave = true; await retry.page.startStudy();
  assert.match(retry.page.data.studyStartError, /本机学习任务/);
  retry.page.copyStudyDiagnostic();
  assert.match(retry.calls.clipboard, /A6/);
  assert.doesNotMatch(retry.calls.clipboard, /storage write failed/);
  assert.strictEqual(retry.calls.navigation.length, 0);
  retry.calls.failSave = false; retry.calls.failOpen = true; await retry.page.startStudy();
  assert.match(retry.page.data.studyStartError, /任务已保存/);
  const saved = retry.store.getSession();
  retry.calls.failOpen = false; await retry.page.startStudy();
  assert.deepStrictEqual(retry.store.getSession(), saved, 'a navigation retry reopens the saved task instead of generating a second one');
  assert.strictEqual(retry.page.data.studyStartError, '');
  assert.strictEqual(retry.page.data.studyStartLabel, '');
  console.log('Study entry: bundled FSRS, device-independent start, unfinished prior-day work, handoff refusal, write failure and navigation retry passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
