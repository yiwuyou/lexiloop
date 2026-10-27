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
assert.strictEqual(fs.readFileSync(path.join(root, 'utils/sync-model.js'), 'utf8'), fs.readFileSync(path.join(root, 'cloudfunctions/lexiloop-sync/model.generated.js'), 'utf8'));

// Run the actual deployed handler against a transaction-capable fake database.
const rows = new Map();
let identity = { OPENID: 'user-1', APPID: 'wxee41f64becac8cf2' };
let failRead = false;
function collection(name, table = rows) {
  return {
    limit() { return { field() { return { async get() { if (failRead) throw new Error('offline'); return { data: [] }; } }; } }; },
    doc(id) { return {
      async get() { if (failRead) throw new Error('network unavailable'); return { data: table.has(`${name}/${id}`) ? clone(table.get(`${name}/${id}`)) : null }; },
      async set({ data }) { table.set(`${name}/${id}`, clone(data)); return {}; },
    }; },
    where(query) { return { async remove() {
      for (const [id, data] of table) if (id.startsWith(`${name}/`) && data.owner === query.owner && data.day < query.day.lt) table.delete(id);
    } }; },
  };
}
const db = {
  command: { lt: value => ({ lt: value }) },
  collection,
  async runTransaction(fn) {
    const copy = new Map(Array.from(rows, ([key, value]) => [key, clone(value)]));
    const result = await fn({ collection: name => collection(name, copy) });
    rows.clear(); copy.forEach((value, key) => rows.set(key, value));
    return { result };
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
function client(seed) {
  const values = {}, cache = new Map();
  if (seed) {
    values.mem_vocab_state_v1 = clone(seed.state);
    values.mem_vocab_settings_v1 = clone(seed.settings);
    if (seed.session) values.mem_vocab_session_v1 = clone(seed.session);
  }
  const net = { online: true, hold: false, release: null, failWrite: null };
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
      init() {},
      callFunction({ data }) {
        if (!net.online) return Promise.reject(new Error('offline'));
        const result = server(clone(data)).then(result => ({ result }));
        if (net.hold && data.action === 'sync') { net.hold = false; return new Promise(resolve => { net.release = () => result.then(resolve); }); }
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
    const fn = vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { wx, Date, Math, console, setTimeout, clearTimeout, setInterval, clearInterval });
    fn(local, module, module.exports); return module.exports;
  }
  return { sync: requireLocal('./utils/cloud-sync.js'), store: requireLocal('./utils/store.js'), storage: requireLocal('./utils/sync-storage.js'), values, net };
}
async function main() {
  assert.strictEqual((await call('health')).storageReady, true);
  assert.strictEqual((await call('health')).transactionReady, true);
  assert.strictEqual(rows.size, 0, 'health diagnostics never create learning records');
  failRead = true;
  assert.strictEqual((await call('health')).ok, false, 'health reports storage failure without exposing learning data');
  failRead = false;
  assert.strictEqual((await call('status')).exists, false);
  identity = { OPENID: '', APPID: 'wxee41f64becac8cf2' };
  assert.strictEqual((await call('status')).ok, false, 'identity cannot be supplied by client input');
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
  identity.OPENID = 'user-2';
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
  const row = Array.from(rows.entries()).find(([key]) => key.startsWith('lexiloop_sync/'))[1];
  assert.ok(zlib.gunzipSync(Buffer.from(row.payload, 'base64')).length > 0);
  phone.sync.dispose(); desktop.sync.dispose();
  console.log('Cloud sync passed: protocol merge, delete tombstones, duplicate retry, user/AppID isolation, conservative conflicts, first seed, offline outbox, desktop restore, ownership and in-flight edits.');
}
main().catch(error => { console.error(error); process.exit(1); });
