const store = require('./store');
const model = require('./sync-model');
const storage = require('./sync-storage');
const errors = require('./sync-error');
const wire = require('./sync-wire');
const ENV = 'lj-tx-serv-d1gw7ceh2130f8cc4';
const FUNCTION = 'lexiloop-sync';
const KEY = 'lexiloop_cloud_sync_v1';
const BEFORE_KEY = 'lexiloop_before_cloud_apply_v1';
let meta, flight, timer, capturing = false, ready = false, active = true;
let timerAt = 0, checkedAt = 0, retryAt = 0, failures = 0;
let connecting = null;
let message = '尚未开启云同步';
let lastError = null;
const listeners = new Set();
function load() {
  if (!meta) meta = storage.read(KEY) || {
    device: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
    enabled: false, seq: 0, rev: 0, outbox: [], lastSyncedAt: 0, owner: null,
  };
  return meta;
}
function save() { storage.write(KEY, meta); }
function status() {
  if (!meta) return { text: message, enabled: false, pending: 0, last: '', busy: false, errorText: errors.format(lastError) };
  const date = new Date(meta.lastSyncedAt || 0);
  return {
    text: message, enabled: meta.enabled, pending: meta.outbox.length, busy: !!flight,
    errorText: errors.format(lastError),
    last: meta.lastSyncedAt ? `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '',
  };
}
function emit(text) {
  if (text) message = text;
  listeners.forEach(fn => { try { fn(status()); } catch (error) { /* A UI listener cannot turn a successful upload into a failure. */ } });
}
function failed(error, stage, text) { lastError = errors.describe(error, stage); emit(text); }
function subscribe(fn) { listeners.add(fn); fn(status()); return () => listeners.delete(fn); }
function blocked() { return !!(meta && meta.enabled && meta.owner && meta.owner.device !== meta.device); }
function capture() {
  if (!meta || !meta.enabled || capturing) return;
  capturing = true;
  try {
    const current = store.bundle();
    const changes = model.diff(meta.observed || current, current);
    if (!changes.length) return;
    meta.seq++;
    // Keep just the latest unsent task image per ownership epoch. Earlier
    // events still carry their sequence IDs and answer/card changes. Replace
    // objects rather than mutate a batch already being sent over the network.
    changes.filter(change => change.path.length === 1).forEach(change => {
      const key = change.path[0], epoch = meta.owner && meta.owner.epoch || 0;
      meta.outbox = meta.outbox.map(event => event.epoch !== epoch ? event : Object.assign({}, event, {
        changes: event.changes.filter(old => old.path.length !== 1 || old.path[0] !== key),
      }));
      change.before = null;
    });
    meta.outbox.push({ device: meta.device, seq: meta.seq, baseRev: meta.rev, epoch: meta.owner && meta.owner.epoch || 0, changes });
    meta.observed = model.clone(current);
    save();
    emit('有记录待同步');
    const answers = meta.outbox.reduce((n, event) => n + event.changes.filter(change => change.path[1] === 'recentReviews').length, 0);
    if (answers >= 10) schedule(1);
    else schedule(60000);
  } finally { capturing = false; }
}
function schedule(delay) {
  const at = Math.max(Date.now() + delay, retryAt);
  if (timer && timerAt <= at) return;
  clearTimeout(timer); timerAt = at;
  timer = setTimeout(() => { timer = null; automatic(false); }, Math.max(0, at - Date.now()));
}
function automatic(check) {
  if (!meta || !meta.enabled) return;
  if (Date.now() < retryAt) { if (meta.outbox.length) schedule(60000); return; }
  if (meta.outbox.length || check && Date.now() - checkedAt >= 60000) flush().catch(() => {});
}
async function frame(data) {
  if (!ready) throw new Error('当前微信不支持云同步');
  let timeout;
  try {
    const result = await Promise.race([
      wx.cloud.callFunction({ name: FUNCTION, config: { env: ENV }, data: Object.assign({ protocol: model.VERSION, wireVersion: 1, device: meta.device }, data) }),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error('网络超时'), { code: 'SYNC_TIMEOUT' })), 15000); }),
    ]);
    let body = result && result.result;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (error) { body = null; } }
    if (!body || !body.ok) throw Object.assign(new Error(body && body.message || '云函数未返回有效的同步结果'), {
      code: body && body.code || 'SYNC_BAD_RESPONSE',
      syncRequestId: result && (result.requestID || result.requestId),
      syncStage: body && body.step,
    });
    return body;
  } catch (error) {
    if (!error || typeof error !== 'object') error = new Error(String(error));
    throw error;
  } finally { clearTimeout(timeout); }
}
async function request(action, data = {}) {
  try { return await wire.send(frame, Object.assign({ action, deltaVersion: 1 }, data)); }
  catch (error) { if (!error.syncStage) error.syncStage = action; throw error; }
}
function accept(result) {
  if (result.unchanged) {
    meta.owner = result.owner;
    meta.lastSyncedAt = Date.now();
    save();
    lastError = null;
    emit(meta.outbox.length ? '有记录待同步' : '已同步');
    return;
  }
  if (result.delta && result.delta.baseRev !== meta.rev) throw new Error('sync-delta-base-mismatch');
  if (!result.delta && !model.valid(result.bundle)) throw new Error('云端记录版本不兼容，未覆盖本机');
  const previous = store.bundle();
  // Keep local records and queues while any later edits are still in flight.
  const remaining = meta.outbox.filter(event => event.seq > (result.ack || 0));
  const combined = result.delta ? model.overlay(model.clone(previous), result.delta.changes) : model.clone(result.bundle);
  remaining.forEach(event => model.apply(combined, event, { owner: result.owner }));
  storage.write(BEFORE_KEY, { at: Date.now(), bundle: previous });
  try { store.replaceBundle(combined); }
  catch (error) { error.syncStage = 'apply'; throw error; }
  meta.outbox = remaining;
  meta.observed = model.clone(combined);
  meta.rev = result.rev;
  meta.owner = result.owner;
  meta.enabled = true;
  meta.lastSyncedAt = Date.now();
  save();
  lastError = null;
  emit(remaining.length ? '有记录待同步' : '已同步');
}
async function flush() {
  if (flight) return flight;
  if (!meta || !meta.enabled) return false;
  try { capture(); } catch (error) { failed(error, 'local', '本机同步队列未保存，请勿清缓存'); throw error; }
  clearTimeout(timer); timer = null;
  flight = (async () => {
    try {
      checkedAt = Date.now();
      const batch = meta.outbox.slice(0, 60);
      if (batch.length) emit('正在同步');
      const result = await request('sync', { events: batch, knownRev: meta.rev });
      if (!result.exists) throw new Error('云端存档不存在，本机记录已保留');
      accept(result);
      failures = 0; retryAt = 0;
      if (meta.outbox.length) schedule(1000);
      return true;
    } catch (error) {
      failed(error, 'apply', '同步未成功，本地记录已保存');
      retryAt = Date.now() + Math.min(900000, 60000 * Math.pow(2, Math.min(failures++, 4)));
      if (active && meta.outbox.length) schedule(60000);
      throw error;
    } finally { flight = null; }
  })();
  return flight;
}
function meaningful(bundle) {
  return bundle.state.recentReviews.length > 0 || Object.keys(bundle.state.sentenceBook || {}).length > 0
    || Object.keys(bundle.state.weakBook || {}).length > 0
    || Object.values(bundle.state.cards).some(card => Number(card.reps || 0) > 0);
}
async function connect(create) {
  if (connecting) { await connecting; if (!create || meta.enabled) return meta.enabled; }
  if (flight) await flight;
  const local = store.bundle();
  const remote = await request('status');
  if (!remote.exists && !create) { emit('尚未开启云同步'); return false; }
  let result = remote;
  if (!remote.exists) {
    if (!model.learned(local)) throw new Error('本机没有学习记录，请先在手机开启');
    result = await request('bootstrap', { bundle: local });
  } else if (meaningful(local) && !meta.enabled) {
    result = await request('attach', { bundle: local });
  }
  // Initial transfers can take a while. Preserve any learning/bookmark edits
  // made after taking the seed image instead of applying an older image over them.
  if (!meta.enabled) {
    const changes = model.diff(local, store.bundle());
    if (changes.length) {
      meta.outbox.push({ device: meta.device, seq: ++meta.seq, baseRev: result.rev, epoch: result.owner && result.owner.epoch || 0, changes });
      save();
    }
  }
  accept(result);
  if (meta.outbox.length) schedule(1000);
  return true;
}
async function enable() {
  if (!ready) start();
  try {
    if (!ready) throw Object.assign(new Error(lastError && lastError.detail || '当前微信不支持云同步'), { code: lastError && lastError.code || 'SYNC_UNSUPPORTED', syncStage: 'init' });
    return await connect(true);
  }
  catch (error) { failed(error, 'apply', '未能完成同步，本地记录已保留'); throw error; }
}
async function beginStudy() {
  // A known local owner can resume immediately, including offline. Background
  // verification still blocks answers if a different device has taken over.
  if (meta && meta.enabled && meta.owner && meta.owner.device === meta.device) {
    automatic(true);
    return true;
  }
  if (connecting) await connecting;
  if (!meta || !meta.enabled) return true; // Offline local learning remains usable.
  try {
    while (meta.outbox.length) await flush();
    const result = await request('claim', { knownRev: meta.rev });
    accept(result);
    return true;
  } catch (error) {
    if (blocked()) {
      wx.showToast({ title: '需联网接续另一台设备的任务', icon: 'none' });
      return false;
    }
    return true; // Known local owner can continue offline, then upload its answers.
  }
}
function start() {
  if (ready) return;
  try {
    load();
    if (!wx.cloud || !wx.cloud.init || !wx.cloud.callFunction) throw Object.assign(new Error('当前微信暂不支持云同步'), { code: 'SYNC_UNSUPPORTED' });
    wx.cloud.init({ env: ENV, traceUser: false });
    ready = true;
    if (!meta.observed) meta.observed = model.clone(store.bundle());
    save();
    store.onChange(capture);
    if (meta.enabled) flush().catch(() => {});
    else {
      connecting = connect(false).catch(error => failed(error, 'status', '尚未连接云端，点击重试')).finally(() => { connecting = null; });
    }
  } catch (error) { ready = false; failed(error, 'init', '云同步暂不可用，本地记录已保留'); }
}
function foreground(online) { active = true; if (online) { retryAt = 0; failures = 0; } if (!ready) start(); else automatic(true); }
function background() { active = false; if (meta && meta.enabled && meta.outbox.length) automatic(false); clearTimeout(timer); timer = null; }
function dispose() { clearTimeout(timer); store.onChange(null); listeners.clear(); }
module.exports = { start, foreground, background, status, subscribe, enable, flush, beginStudy, blocked, capture, dispose, ENV, FUNCTION };
