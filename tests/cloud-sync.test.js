const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const zlib = require('zlib');
const model = require('../utils/sync-model');
const clone = model.clone;
const root = path.resolve(__dirname, '..');
const now = new Date(2026, 9, 27, 12).getTime();
const blank = () => ({
  state: { schemaVersion: 3, createdAt: now, cards: {}, daily: {}, weakBook: {}, recentReviews: [] },
  settings: { schemaVersion: 2, dailyNewCount: 50, dailyReviewLimit: 100, reviewLimitVersion: 1 }, session: null, practiceSession: null,
});
const base = blank();
base.state.cards['c-1-1'] = { seen: true, reps: 1, interval: 3, dueAt: now + 3 * 86400000, lastAt: now };
const review = (bundle, wordId, grade, at = now) => {
  const result = clone(bundle);
  result.state.cards[wordId] = { seen: true, reps: 2, interval: grade === 'again' ? 0 : 3, dueAt: at + (grade === 'again' ? 600000 : 3 * 86400000), lastAt: at, lastGrade: grade, needsRecall: grade === 'again' };
  result.state.daily['2026-10-27'] = { dueGoal: 100, dueDone: 1 };
  result.state.recentReviews.push({ id: `r-${wordId}-${grade}-${at}`, wordId, at, day: '2026-10-27', phase: 'review', result: grade });
  return result;
};
const event = (before, after, seq = 1, device = 'device-a', baseRev = 1, epoch = 1) => ({ device, seq, baseRev, epoch, changes: model.diff(before, after) });

const passed = review(base, 'c-1-1', 'good');
const missed = review(base, 'c-1-1', 'again');
const merged = clone(base), versions = {};
model.apply(merged, event(base, passed), { versions, nextRev: 2 });
model.apply(merged, event(base, missed, 1, 'device-b'), { versions, nextRev: 3 });
assert.strictEqual(merged.state.cards['c-1-1'].needsRecall, true);
assert.strictEqual(merged.state.recentReviews.length, 2, 'concurrent answers are both retained');
assert.strictEqual(merged.state.daily['2026-10-27'].dueDone, 1, 'same word is not counted twice');
model.apply(merged, event(base, review(base, 'c-1-2', 'good'), 2), { versions, nextRev: 4 });
assert.strictEqual(merged.state.daily['2026-10-27'].dueDone, 2, 'different words on different devices count independently');
assert.throws(() => model.apply(clone(base), { changes: [{ path: ['state', 'cards', '__proto__'], after: {} }] }), /invalid-path/);
const saved = clone(base); saved.state.sentenceBook = { 'A sentence.': { sentence: 'A sentence.', translation: '例句。' } };
const cancelled = clone(saved); cancelled.state.sentenceBook = {};
const book = clone(saved), bookVersions = {};
model.apply(book, event(saved, cancelled), { versions: bookVersions, nextRev: 2 });
model.apply(book, event(cancelled, saved, 1, 'device-b', 1), { versions: bookVersions, nextRev: 3 });
assert.ok(!book.state.sentenceBook['A sentence.'], 'stale other-device add cannot resurrect a deletion');
model.apply(book, event(cancelled, saved, 2, 'device-a', 1), { versions: bookVersions, nextRev: 3 });
assert.ok(book.state.sentenceBook['A sentence.'], 'causally later re-save by the same device is valid');
const placeholder = clone(base); placeholder.state.cards['c-1-1'] = { seen: true, reps: 0, interval: 0, recoveredAt: now };
assert.strictEqual(model.attach(base, placeholder).state.cards['c-1-1'].reps, 1, 'recovery placeholder cannot reset an actual cloud answer');
const task = clone(base); task.session = { index: 4, queue: [{ wordId: 'c-1-1' }] };
model.apply(task, { ...event(base, { ...base, session: { index: 0, queue: [] } }), epoch: 1 }, { owner: { device: 'device-b', epoch: 2 } });
assert.strictEqual(task.session.index, 4, 'old owner cannot overwrite the current task');
assert.throws(() => model.overlay(clone(base), [{ path: ['state', 'cards', '__proto__'], after: {} }]), /invalid-path/);
assert.strictEqual(fs.readFileSync(path.join(root, 'utils/sync-model.js'), 'utf8'), fs.readFileSync(path.join(root, 'cloudfunctions/lexiloop-sync/model.generated.js'), 'utf8'));

// Run the actual deployed handler against a transaction-capable fake database.
const rows = new Map();
let identity = { OPENID: 'user-1', APPID: 'wxee41f64becac8cf2' };
let failRead = false;
let throwMissing = false;
let directTransactionResult = false;
let transactionChain = Promise.resolve();
function collection(name, table = rows) {
  return {
    limit() { return { field() { return { async get() { if (failRead) throw new Error('offline'); return { data: [] }; } }; } }; },
    doc(id) { return {
      async get() {
        if (failRead) throw new Error('network unavailable');
        if (throwMissing && !table.has(`${name}/${id}`)) throw { errCode: -1, errMsg: `document.get:fail document with _id ${id} does not exist` };
        return { data: table.has(`${name}/${id}`) ? clone(table.get(`${name}/${id}`)) : null };
      },
      async set({ data }) { table.set(`${name}/${id}`, clone(data)); return {}; },
    }; },
    where(query) { return { async remove() {
      for (const [id, data] of table) if (id.startsWith(`${name}/`) && (query.expires ? data.expires < query.expires.lt : data.owner === query.owner && data.day < query.day.lt)) table.delete(id);
    } }; },
  };
}
const db = {
  command: { lt: value => ({ lt: value }) },
  collection,
  runTransaction(fn) {
    const flight = transactionChain.then(async () => {
    const copy = new Map(Array.from(rows, ([key, value]) => [key, clone(value)]));
    const result = await fn({ collection: name => collection(name, copy) });
    rows.clear(); copy.forEach((value, key) => rows.set(key, value));
    return directTransactionResult ? result : { result };
    });
    transactionChain = flight.catch(() => {});
    return flight;
  },
};
const realLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'wx-server-sdk') return { init() {}, database: () => db, getWXContext: () => identity };
  return realLoad.call(this, name, parent, isMain);
};
const server = require('../cloudfunctions/lexiloop-sync').main;
Module._load = realLoad;
const call = (action, data = {}) => server({ protocol: 1, action, device: 'device-a', ...data });
const tick = () => new Promise(resolve => setImmediate(resolve));

// Independent module graphs simulate the phone and desktop local storage.
function client(seed, clock) {
  const values = {}, cache = new Map();
  if (seed) {
    values.mem_vocab_state_v1 = clone(seed.state);
    values.mem_vocab_settings_v1 = clone(seed.settings);
    if (seed.session) values.mem_vocab_session_v1 = clone(seed.session);
  }
  const net = { online: true, hold: false, release: null, failWrite: null, failAction: null, failure: null, initFailure: null, jsonResult: false, calls: [], frames: [], maxFrame: 0 };
  const wx = {
    getStorageSync: key => values[key] ? clone(values[key]) : '',
    setStorageSync: (key, value) => {
      if (net.failWrite && net.failWrite(key)) throw new Error('storage write failed');
      assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 1024 * 1024, 'single storage key exceeds WeChat limit');
      values[key] = clone(value);
    },
    removeStorageSync: key => { delete values[key]; },
    showToast() {},
    cloud: {
      init() { if (net.initFailure) throw net.initFailure; },
      callFunction({ data }) {
        const size = Buffer.byteLength(JSON.stringify(data));
        assert.ok(size < 32768, 'request exceeds conservative 32 KiB gateway budget');
        net.maxFrame = Math.max(net.maxFrame, size);
        net.frames.push(clone(data));
        net.calls.push(data.action);
        if (net.failAction === data.action && (net.failIndex == null || data.index === net.failIndex)) return Promise.reject(net.failure || { errCode: -501000, errMsg: 'cloud.callFunction:fail errCode: -501000 env not exists' });
        if (!net.online) return Promise.reject(new Error('offline'));
        const result = server(clone(data)).then(result => {
          assert.ok(Buffer.byteLength(JSON.stringify(result)) < 32768, 'response exceeds conservative 32 KiB gateway budget');
          return { result: net.jsonResult ? JSON.stringify(result) : result, requestID: 'request-test-1234' };
        });
        if (net.hold && data.action === (net.holdAction || 'sync')) { net.hold = false; return new Promise((resolve, reject) => { net.release = () => net.holdFailure ? reject(net.holdFailure) : result.then(resolve, reject); }); }
        return result;
      },
    },
  };
  function requireLocal(file) {
    if (!file.startsWith('.')) throw new Error('unexpected builtin');
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const local = name => requireLocal(path.relative(root, path.resolve(path.dirname(filename), name.endsWith('.js') ? name : `${name}.js`)).replace(/^/, './'));
    const fn = vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { wx, Date, Math, console, setTimeout, clearTimeout, setInterval, clearInterval, ...clock && clock.api });
    fn(local, module, module.exports); return module.exports;
  }
  return { sync: requireLocal('./utils/cloud-sync.js'), store: requireLocal('./utils/store.js'), storage: requireLocal('./utils/sync-storage.js'), values, net };
}
function virtualClock() {
  let time = Date.now(), next = 1;
  const tasks = new Map();
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  return {
    api: {
      Date: ClockDate,
      setTimeout(fn, delay) { const id = next++; tasks.set(id, { fn, at: time + delay }); return id; },
      clearTimeout(id) { tasks.delete(id); },
      setInterval() { throw new Error('fixed cloud polling must not be reintroduced'); }, clearInterval() {},
    },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = Array.from(tasks).filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        tasks.delete(due[0]); time = due[1].at; due[1].fn(); await tick(); await tick();
      }
      time = end; await tick(); await tick();
    },
  };
}
async function main() {
  assert.strictEqual((await call('health')).storageReady, true);
  assert.strictEqual((await call('health')).transactionReady, true);
  assert.strictEqual(rows.size, 0, 'health diagnostics never create learning records');
  failRead = true;
  assert.strictEqual((await call('health')).ok, false, 'health reports storage failure without exposing learning data');
  failRead = false;
  assert.strictEqual((await call('status')).exists, false);
  throwMissing = true;
  assert.strictEqual((await call('status')).exists, false, 'real wx-server-sdk missing-document exception means no archive, not a transport error');
  throwMissing = false;
  identity = { OPENID: '', APPID: 'wxee41f64becac8cf2' };
  assert.strictEqual((await call('status')).ok, false, 'identity cannot be supplied by client input');
  assert.strictEqual((await call('status')).code, 'IDENTITY_REQUIRED');
  identity = { OPENID: 'user-1', APPID: 'wrong-app' };
  assert.strictEqual((await call('status')).ok, false);
  identity = { OPENID: 'user-1', APPID: 'wxee41f64becac8cf2' };
  assert.strictEqual((await call('bootstrap', { bundle: blank() })).ok, false, 'empty seed is forbidden');
  const initial = await call('bootstrap', { bundle: base });
  assert.strictEqual(initial.rev, 1);
  const second = await call('bootstrap', { bundle: passed });
  assert.strictEqual(second.bundle.state.cards['c-1-1'].reps, 1, 'second bootstrap cannot replace first archive');
  const patch = event(base, passed);
  const first = await call('sync', { events: [patch] });
  assert.strictEqual(first.ack, 1);
  const repeated = await call('sync', { events: [patch] });
  assert.strictEqual(repeated.bundle.state.recentReviews.length, 1, 'network retry is idempotent');
  const claim = await call('claim', { device: 'device-b' });
  assert.strictEqual(claim.owner.device, 'device-b');
  const snapshotCount = Array.from(rows.keys()).filter(key => key.startsWith('lexiloop_snapshots/')).length;
  assert.strictEqual(snapshotCount, 1, 'only one daily snapshot');
  failRead = true;
  assert.strictEqual((await call('status')).ok, false, 'read failure is never treated as an empty cloud');
  failRead = false;
  identity.OPENID = 'delta-protocol-user';
  await call('bootstrap', { bundle: base });
  const sameOwner = await call('claim', { knownRev: 1, deltaVersion: 1 });
  assert.strictEqual(sameOwner.rev, 1, 'repeated same-device claim does not create a new revision or ownership epoch');
  assert.ok(sameOwner.unchanged && !sameOwner.bundle);
  const deltaReply = await call('sync', { knownRev: 1, deltaVersion: 1, events: [patch] });
  assert.ok(deltaReply.delta && !deltaReply.bundle, 'ordinary answer update returns only changed fields');
  assert.deepStrictEqual(model.overlay(clone(base), deltaReply.delta.changes), first.bundle);
  const retryDelta = await call('sync', { knownRev: 1, deltaVersion: 1, events: [patch] });
  assert.strictEqual(retryDelta.rev, deltaReply.rev, 'retry neither reapplies answers nor increments revision');
  const withBook = clone(passed); withBook.state.weakBook['c-2'] = { addedAt: now };
  await call('sync', { knownRev: 2, deltaVersion: 1, events: [event(passed, withBook, 2, 'device-a', 2)] });
  const catchup = await call('status', { knownRev: 1, deltaVersion: 1 });
  assert.deepStrictEqual(model.overlay(clone(base), catchup.delta.changes), (await call('status')).bundle, 'several unseen revisions collapse into one authoritative delta');
  await call('claim', { device: 'device-b', knownRev: 3, deltaVersion: 1 });
  const staleTask = clone(withBook); staleTask.session = { index: 0, queue: [] };
  const rejectedTask = await call('sync', { knownRev: 4, deltaVersion: 1, events: [event(withBook, staleTask, 3, 'device-a', 3, 1)] });
  assert.ok(!model.overlay(staleTask, rejectedTask.delta.changes).session, 'authoritative delta removes rejected stale-owner task image');
  assert.strictEqual(require('../cloudfunctions/lexiloop-sync/delta').since({ rev: 6, deltas: [{ from: 5, rev: 6, changes: [] }] }, 1), null, 'journal gap safely falls back to complete archive');
  identity.OPENID = 'user-2';
  directTransactionResult = true; // The deployed database SDK returns the callback value directly.
  assert.strictEqual((await call('status')).exists, false, 'users cannot read one another');

  const phone = client(base);
  phone.sync.start(); await tick(); await tick();
  assert.strictEqual(phone.sync.status().enabled, false);
  await phone.sync.enable();
  assert.strictEqual(phone.sync.status().text, '已同步');
  const phoneState = phone.store.getState();
  phoneState.cards['c-1-2'] = { seen: true, reps: 1, lastAt: now + 100, interval: 3, dueAt: now + 300000 };
  phone.store.appendReview(phoneState, { at: now + 100, day: '2026-10-27', wordId: 'c-1-2', phase: 'new', result: 'good' });
  phone.store.saveState(phoneState);
  phone.net.online = false;
  await assert.rejects(phone.sync.flush());
  assert.ok(phone.sync.status().pending > 0);
  assert.ok(phone.store.getState().cards['c-1-2']);
  phone.net.online = true;
  await phone.sync.flush();
  assert.strictEqual(phone.sync.status().pending, 0);
  // Hold the network indefinitely: local-owner resume must not wait for it.
  phone.net.hold = true;
  const held = phone.sync.flush(); await tick();
  const beforeResume = phone.net.calls.length;
  assert.strictEqual(await Promise.race([phone.sync.beginStudy(), new Promise((_, reject) => setTimeout(() => reject(new Error('resume waited for network')), 100))]), true);
  assert.ok(!phone.net.calls.slice(beforeResume).includes('claim'), 'same-device resume does not claim again');
  phone.net.release(); await held;
  const states = [];
  const stopIdle = phone.sync.subscribe(value => states.push(value.text));
  await phone.sync.flush(); stopIdle();
  assert.ok(!states.includes('正在同步'), 'an empty background revision check does not show a pending upload');
  const desktop = client(blank());
  desktop.sync.start(); await tick(); await tick();
  assert.strictEqual(desktop.sync.status().enabled, true);
  assert.ok(desktop.store.getState().cards['c-1-2'], 'new desktop restores phone progress automatically');
  assert.ok(await desktop.sync.beginStudy());
  await phone.sync.flush();
  assert.strictEqual(phone.sync.blocked(), true);
  assert.strictEqual(desktop.sync.blocked(), false);
  desktop.store.saveSession({ index: 7, queue: [{ wordId: 'c-1-2', phase: 'review' }] });
  await desktop.sync.flush();
  phone.store.saveSession({ index: 0, queue: [{ wordId: 'c-1-1', phase: 'new' }] });
  await phone.sync.flush();
  assert.strictEqual(phone.store.getSession().index, 7, 'stale owner task is not restored over desktop task');

  // Uploading a batch must not erase edits made while waiting for its reply.
  desktop.net.hold = true;
  const inFlight = desktop.sync.flush(); await tick();
  const extra = desktop.store.getState(); extra.weakBook['c-1-3'] = { addedAt: now };
  desktop.store.saveState(extra);
  desktop.net.release(); await inFlight;
  assert.ok(desktop.store.getState().weakBook['c-1-3']);
  assert.ok(desktop.sync.status().pending > 0);
  await desktop.sync.flush();
  await phone.sync.flush();
  assert.ok(phone.store.getState().weakBook['c-1-3']);
  // Long offline sessions keep only one task snapshot, not one per answer.
  desktop.net.online = false;
  const queue = Array.from({ length: 150 }, (_, i) => ({ wordId: `c-1-${i + 1}`, phase: 'review' }));
  for (let i = 0; i < 160; i++) desktop.store.saveSession({ queue, index: i % 150 });
  const pendingMeta = desktop.storage.read('lexiloop_cloud_sync_v1');
  assert.strictEqual(pendingMeta.outbox.flatMap(item => item.changes).filter(item => item.path.length === 1 && item.path[0] === 'session').length, 1);
  desktop.net.online = true;
  while (desktop.sync.status().pending) await desktop.sync.flush();
  assert.strictEqual(desktop.store.getSession().index, 9);
  // Publishing a multi-key journal is atomic even when a later chunk fails.
  const large = { text: '例句'.repeat(250000) };
  desktop.storage.write('test-journal', large);
  assert.strictEqual(desktop.storage.read('test-journal').text, large.text);
  let writes = 0;
  desktop.net.failWrite = key => key.startsWith('test-journal:') && ++writes === 2;
  assert.throws(() => desktop.storage.write('test-journal', { text: '新例'.repeat(250000) }));
  desktop.net.failWrite = null;
  assert.strictEqual(desktop.storage.read('test-journal').text, large.text, 'failed chunk write preserves previous manifest');
  desktop.storage.remove('test-journal');
  assert.ok(!Object.keys(desktop.values).some(key => key.startsWith('test-journal')));
  // An interrupted apply is completed before any new local study can start.
  const apply = desktop.store.bundle(); apply.state.weakBook['c-1-4'] = { addedAt: now };
  desktop.net.failWrite = key => key === 'mem_vocab_settings_v1';
  assert.throws(() => desktop.store.replaceBundle(apply));
  assert.ok(desktop.values.mem_vocab_cloud_apply_v1);
  desktop.net.failWrite = null;
  desktop.store.resumeCloudApply();
  assert.ok(desktop.store.getState().weakBook['c-1-4']);
  assert.ok(!desktop.values.mem_vocab_cloud_apply_v1);
  const oldDeviceBundle = blank(); oldDeviceBundle.state.weakBook = { 'c-1-5': { addedAt: now } };
  const oldDevice = client(oldDeviceBundle);
  oldDevice.sync.start(); await tick(); await tick();
  assert.ok(oldDevice.store.getState().weakBook['c-1-5'], 'joining device preserves manually marked weak words even without answer history');
  oldDevice.sync.dispose();
  identity.OPENID = 'diagnostic-empty-user';
  const broken = client(base);
  broken.net.failAction = 'status';
  broken.sync.start(); await tick(); await tick();
  await assert.rejects(broken.sync.enable());
  assert.ok(broken.sync.status().errorText.includes('-501000'));
  assert.ok(broken.sync.status().errorText.includes('读取云端存档'));
  assert.ok(!broken.net.calls.includes('bootstrap'), 'failed status cannot create or replace an archive');
  assert.ok(broken.store.getState().cards['c-1-1']);
  broken.net.failAction = 'bootstrap';
  broken.net.failure = { errCode: -1, errMsg: 'cloud.callFunction:fail failed to upload' };
  await assert.rejects(broken.sync.enable());
  assert.ok(broken.sync.status().errorText.includes('首次上传'));
  assert.strictEqual(broken.sync.status().enabled, false);
  broken.net.failAction = null; broken.net.jsonResult = true;
  await broken.sync.enable();
  assert.strictEqual(broken.sync.status().errorText, '', 'successful ack clears diagnostic failure');
  const stopThrowing = broken.sync.subscribe(() => {});
  let throwNow = false;
  const stopUi = broken.sync.subscribe(() => { if (throwNow) throw new Error('UI update failed'); });
  throwNow = true;
  assert.ok(await broken.sync.flush(), 'UI listener exception cannot fail acknowledged sync');
  stopThrowing(); stopUi(); broken.sync.dispose();
  identity.OPENID = 'init-retry-user';
  const retryInit = client(base);
  retryInit.net.initFailure = { errCode: -404, errMsg: 'cloud.init failed' };
  retryInit.sync.start();
  assert.ok(retryInit.sync.status().errorText.includes('初始化云连接'));
  retryInit.net.initFailure = null;
  await retryInit.sync.enable();
  assert.strictEqual(retryInit.sync.status().text, '已同步', 'manual retry can recover an initial SDK initialization failure');
  retryInit.sync.dispose();
  // A realistic large archive must cross the same size-limited gateway in
  // both directions. Earlier tests with a one-card seed missed the phone bug.
  identity.OPENID = 'large-archive-user';
  const rich = blank();
  for (let i = 0; i < 1036; i++) rich.state.cards[`c-${i}`] = { seen: true, reps: 2, interval: 3, lastAt: now, dueAt: now + 1000, note: '学习记录，保留中文含义和复习结果。' };
  for (let i = 0; i < 1000; i++) rich.state.recentReviews.push({ id: `rich-${i}`, wordId: `c-${i}`, at: now + i, day: '2026-10-27', phase: 'review', result: 'good' });
  rich.session = { index: 40, queue: Array.from({ length: 150 }, (_, i) => ({ wordId: `c-${i}`, phase: 'review' })) };
  const largePhone = client(rich);
  largePhone.sync.start(); await tick(); await tick();
  largePhone.net.failAction = 'wire-put';
  largePhone.net.failIndex = 4;
  await assert.rejects(largePhone.sync.enable());
  assert.strictEqual(largePhone.sync.status().enabled, false);
  assert.strictEqual((await call('status')).exists, false, 'partial upload never creates an archive');
  const incomplete = largePhone.net.frames.find(frame => frame.action === 'wire-put');
  assert.strictEqual((await server({ ...incomplete, action: 'wire-commit' })).ok, false, 'missing frames cannot be committed');
  assert.strictEqual(Object.keys(largePhone.store.getState().cards).length, 1036);
  largePhone.net.failAction = null;
  largePhone.net.hold = true; largePhone.net.holdAction = 'wire-commit';
  const seeding = largePhone.sync.enable();
  while (!largePhone.net.release) await tick();
  const duringSeed = largePhone.store.getState(); duringSeed.weakBook['c-20'] = { addedAt: now };
  largePhone.store.saveState(duringSeed);
  largePhone.net.release(); await seeding;
  assert.ok(largePhone.store.getState().weakBook['c-20'], 'edits made while first upload is in flight survive');
  await largePhone.sync.flush();
  assert.strictEqual(largePhone.sync.status().text, '已同步');
  assert.ok(largePhone.net.calls.includes('wire-commit') && largePhone.net.calls.includes('wire-get'));
  const staged = largePhone.net.frames.filter(frame => frame.action === 'wire-put').pop();
  identity.OPENID = 'other-transfer-user';
  assert.strictEqual((await server({ ...staged, action: 'wire-commit' })).ok, false, 'staging tokens cannot cross users');
  identity.OPENID = 'large-archive-user';
  assert.strictEqual((await server({ ...staged, text: 'X'.repeat(staged.text.length) })).ok, false, 'received chunks cannot be mutated');
  const largeDesktop = client(blank());
  largeDesktop.net.failAction = 'wire-get';
  largeDesktop.sync.start(); await tick(); await tick();
  assert.strictEqual(Object.keys(largeDesktop.store.getState().cards).length, 0, 'failed download never applies partial archive');
  largeDesktop.net.failAction = null;
  await largeDesktop.sync.enable();
  assert.strictEqual(Object.keys(largeDesktop.store.getState().cards).length, 1036);
  assert.strictEqual(largeDesktop.store.getState().recentReviews.length, 1000);
  assert.strictEqual(largeDesktop.store.getSession().index, 40);
  const beforeClaim = largeDesktop.net.calls.length;
  await largeDesktop.sync.beginStudy();
  assert.ok(!largeDesktop.net.calls.slice(beforeClaim).includes('wire-get'), 'cross-device handoff does not redownload 1036 cards');
  assert.ok(largeDesktop.net.calls.length - beforeClaim <= 2, 'up-to-date handoff takes only revision check and small claim request');
  const newer = largePhone.store.getState();
  newer.sentenceBook = {};
  for (let i = 0; i < 180; i++) newer.sentenceBook[`Example ${i}.`] = { sentence: `Example ${i}.`, translation: '保留所有收藏例句和释义。'.repeat(15) };
  largePhone.store.saveState(newer);
  await largePhone.sync.flush();
  await largeDesktop.sync.flush();
  assert.strictEqual(Object.keys(largeDesktop.store.getState().sentenceBook).length, 180, 'large incremental updates use bounded upload too');
  const full = largePhone.store.getState();
  for (let i = 1036; i < 2522; i++) full.cards[`c-${i}`] = { seen: true, reps: 1, dueAt: now, interval: 0 };
  largePhone.store.saveState(full); await largePhone.sync.flush(); await largeDesktop.sync.flush();
  assert.strictEqual(Object.keys(largeDesktop.store.getState().cards).length, 2522, 'full vocabulary archive remains syncable');
  const one = largePhone.store.getState(); one.weakBook['c-2521'] = { addedAt: now + 200 };
  largePhone.store.saveState(one);
  const beforeSmall = largePhone.net.calls.length;
  await largePhone.sync.flush();
  assert.deepStrictEqual(largePhone.net.calls.slice(beforeSmall), ['sync'], 'one small edit in a full 2522-card archive uses one request, not archive chunks');
  const beforeSmallPull = largeDesktop.net.calls.length;
  await largeDesktop.sync.flush();
  assert.deepStrictEqual(largeDesktop.net.calls.slice(beforeSmallPull), ['sync'], 'other device receives small changes in one response');
  assert.ok(largeDesktop.store.getState().weakBook['c-2521']);
  assert.ok(largePhone.net.maxFrame < 32768 && largeDesktop.net.maxFrame < 32768);
  largePhone.sync.dispose(); largeDesktop.sync.dispose();
  identity.OPENID = 'cost-policy-user';
  const clock = virtualClock(), economical = client(base, clock);
  economical.sync.start(); await tick(); await tick(); await economical.sync.enable();
  const idleCalls = economical.net.calls.length;
  await clock.advance(3600000);
  assert.strictEqual(economical.net.calls.length, idleCalls, 'one hour idle makes zero cloud calls');
  economical.sync.foreground(); await tick(); await tick();
  const foregroundCalls = economical.net.calls.length;
  economical.sync.foreground(); economical.sync.foreground(); await tick(); await tick();
  assert.strictEqual(economical.net.calls.length, foregroundCalls, 'duplicate foreground notifications coalesce');
  for (let i = 0; i < 5; i++) {
    const item = economical.store.getState(); item.weakBook[`cost-${i}`] = { addedAt: now };
    economical.store.saveState(item); await clock.advance(10000);
  }
  assert.strictEqual(economical.net.calls.length, foregroundCalls, 'several bookmarks stay local until combined checkpoint');
  await clock.advance(10000);
  assert.strictEqual(economical.net.calls.length, foregroundCalls + 1, 'one minute of small changes produces one request');
  assert.strictEqual(economical.sync.status().pending, 0);
  const beforeEmptyExit = economical.net.calls.length;
  economical.sync.background(); await tick();
  assert.strictEqual(economical.net.calls.length, beforeEmptyExit, 'empty background exit does not query cloud');
  economical.sync.foreground(); economical.net.online = false;
  const offlineState = economical.store.getState(); offlineState.weakBook.offline = { addedAt: now };
  economical.store.saveState(offlineState);
  await clock.advance(60000);
  const firstFailure = economical.net.calls.length;
  for (let i = 0; i < 12; i++) {
    const item = economical.store.getState();
    economical.store.appendReview(item, { id: `offline-cost-${i}`, at: now + i, day: '2026-10-28', wordId: `c-${i}`, phase: 'review', result: 'good' });
    economical.store.saveState(item);
  }
  await clock.advance(59000);
  assert.strictEqual(economical.net.calls.length, firstFailure, 'new offline answers cannot bypass retry backoff');
  await clock.advance(1000);
  assert.strictEqual(economical.net.calls.length, firstFailure + 1);
  await clock.advance(119000);
  assert.strictEqual(economical.net.calls.length, firstFailure + 1, 'second failure waits two minutes');
  economical.net.online = true; economical.sync.foreground(true); await tick(); await tick();
  assert.strictEqual(economical.sync.status().pending, 0, 'network restoration drains retained edits');
  economical.net.hold = true; economical.net.holdFailure = new Error('connection dropped');
  const failingFlight = economical.sync.flush(); await tick();
  for (let i = 0; i < 10; i++) {
    const item = economical.store.getState();
    economical.store.appendReview(item, { at: now + 1000 + i, day: '2026-10-28', wordId: `race-${i}`, phase: 'review', result: 'good' });
    economical.store.saveState(item);
  }
  economical.net.release(); await assert.rejects(failingFlight);
  const racedFailureCalls = economical.net.calls.length;
  await clock.advance(59000);
  assert.strictEqual(economical.net.calls.length, racedFailureCalls, 'a timer scheduled during an in-flight failure cannot bypass backoff');
  economical.net.holdFailure = null;
  economical.sync.dispose();
  const medium = { action: 'status', note: 'a'.repeat(9000) };
  let mediumCalls = 0;
  await require('../utils/sync-wire').send(async () => { mediumCalls++; return { ok: true }; }, medium);
  assert.strictEqual(mediumCalls, 1, 'ordinary requests below 24KB do not create temporary transfer documents');
  const wire = require('../utils/sync-wire');
  await assert.rejects(wire.send(async frame => frame.action === 'wire-get' ? { ok: true, text: '{"ok":true}' } : { ok: true, transfer: { token: 'test', count: 1, length: 11, checksum: '0' } }, { action: 'status' }), /checksum-mismatch/, 'download checksum is checked before local apply');
  const css = fs.readFileSync(path.join(root, 'pages/progress/index.wxss'), 'utf8');
  assert.ok(/\.sync-card > button[^}]+width: 100%[^}]+white-space: nowrap/.test(css));
  assert.ok(fs.readFileSync(path.join(root, 'pages/progress/index.wxml'), 'utf8').includes('复制失败原因'));
  const errors = require('../utils/sync-error');
  const hidden = errors.format(errors.describe({ message: 'denied openid=private-user access_token=private-token bundle={secret}' }, 'bootstrap'));
  assert.ok(!hidden.includes('private-user') && !hidden.includes('private-token') && !hidden.includes('{secret}'));
  const row = Array.from(rows.entries()).find(([key]) => key.startsWith('lexiloop_sync/'))[1];
  assert.ok(zlib.gunzipSync(Buffer.from(row.payload, 'base64')).length > 0);
  phone.sync.dispose(); desktop.sync.dispose();
  console.log('Cloud sync passed: protocol merge, delete tombstones, duplicate retry, user/AppID isolation, conservative conflicts, first seed, offline outbox, desktop restore, ownership and in-flight edits.');
}
main().catch(error => { console.error(error); process.exit(1); });
