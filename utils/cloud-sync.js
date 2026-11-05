const store = require('./store');
const model = require('./sync-model');
const storage = require('./sync-storage');
const errors = require('./sync-error');
const wire = require('./sync-wire');
const outbox = require('./sync-outbox');
const budget = require('./sync-budget');
const ENV = 'lj-tx-serv-d1gw7ceh2130f8cc4';
const FUNCTION = 'lexiloop-sync';
const KEY = 'lexiloop_cloud_sync_v1';
const BEFORE_KEY = 'lexiloop_before_cloud_apply_v1';
const QUOTA_DELAY = 3600000;
const HANDOFF_TIMEOUT = 20000;
let meta, flight, timer, capturing = false, ready = false, active = true;
let timerAt = 0, checkedAt = 0, retryAt = 0, failures = 0;
let connecting = null;
let dataRevision = 0;
let studyFlight = null;
let captureTimer = null;
let dirtyAt = 0;
function captureSoon() {
  if (captureTimer) return;
  dirtyAt = Date.now();
  message = '有记录待同步';
  // Both local saves remain durable. Diff/journal work yields to card paint.
  captureTimer = setTimeout(() => {
    captureTimer = null;
    try { capture(); } catch (error) { failed(error, 'local', '本机同步队列未保存，请勿清缓存'); }
  }, 120);
}
let message = '尚未开启云同步';
let lastError = null;
const listeners = new Set();
function load() {
  if (!meta) meta = storage.read(KEY) || {
    device: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
    enabled: false, seq: 0, rev: 0, outbox: [], lastSyncedAt: 0, owner: null,
  };
  if (!meta.fieldChangesVersion) {
    meta.outbox = meta.outbox.map(event => Object.assign({}, event, { changes: model.fineChanges(event.changes) }));
    meta.fieldChangesVersion = 1;
  }
  if (meta.quotaRetryAt > Date.now()) {
    retryAt = Math.max(retryAt, meta.quotaRetryAt);
    lastError = meta.quotaError || lastError;
    message = '云端额度不足，记录保存在本机';
  }
  if (meta.resourceRetryAt > Date.now()) { retryAt = Math.max(retryAt, meta.resourceRetryAt); lastError = meta.resourceError; message = '同步用量保护中，记录保存在本机'; }
  return meta;
}
function save() { storage.write(KEY, meta); }
function status() {
  if (!meta) return { dataRevision, text: message, enabled: false, pending: 0, last: '', busy: false, errorText: errors.format(lastError) };
  const date = new Date(meta.lastSyncedAt || 0);
  return {
    dataRevision, text: message, enabled: meta.enabled, pending: meta.outbox.length + (captureTimer ? 1 : 0), busy: !!flight,
    errorText: errors.format(lastError),
    usageText: meta.requestBudget ? `本机今日已发出同步请求 ${meta.requestBudget.day === new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) ? meta.requestBudget.calls : 0} 次` : '',
    last: meta.lastSyncedAt ? `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '',
  };
}
function emit(text) {
  if (text) message = text;
  listeners.forEach(fn => { try { fn(status()); } catch (error) { /* A UI listener cannot turn a successful upload into a failure. */ } });
}
function quotaPaused() { return Boolean(meta && Math.max(meta.quotaRetryAt || 0, meta.resourceRetryAt || 0) > Date.now()); }
function clearBackoff() { retryAt = 0; failures = 0; delete meta.quotaRetryAt; delete meta.quotaError; delete meta.resourceRetryAt; delete meta.resourceError; }
function failed(error, stage, text) {
  lastError = errors.describe(error, stage);
  if (/^(queue-delta-(base-mismatch|checksum)|missing-session-delta-base|sync-delta-base-mismatch)$/.test(error.message || '')) {
    meta.forceFull = true;
    try { save(); } catch (_) { /* Keep the local bundle and pending events untouched. */ }
  }
  if (error.code === 'SYNC_DAILY_BUDGET' || error.code === 'SYNC_PACKET_BUDGET') {
    retryAt = error.retryAt || (error.code === 'SYNC_DAILY_BUDGET' ? budget.resetAt(Date.now()) : Date.now() + QUOTA_DELAY);
    meta.resourceRetryAt = retryAt; meta.resourceError = lastError;
    try { save(); } catch (_) { /* Preserve the original local protection error. */ }
    emit('同步用量保护中，记录保存在本机'); return;
  }
  if (errors.isQuota(error)) {
    retryAt = Date.now() + QUOTA_DELAY;
    if (meta) {
      meta.quotaRetryAt = retryAt; meta.quotaError = lastError;
      try { save(); } catch (_) { /* Never mask the cloud failure or discard durable learning records. */ }
    }
    emit('云端额度不足，记录保存在本机');
  } else emit(text);
}
function subscribe(fn) { listeners.add(fn); fn(status()); return () => listeners.delete(fn); }
function blocked() { return !!(meta && meta.enabled && meta.owner && meta.owner.device !== meta.device); }
function capture() {
  const changedAt = dirtyAt || Date.now(); dirtyAt = 0;
  clearTimeout(captureTimer); captureTimer = null;
  if (!meta || !meta.enabled || capturing) return;
  capturing = true;
  try {
    const current = store.bundle();
    let changes = model.fineDiff(meta.observed || current, current);
    if (!changes.length) return;
    meta.seq++;
    // A growing day's timing/task maps must not be resent for every pending
    // checkpoint. Preserve the first preimage and last image, plus all event
    // IDs/answers. The pure helper never mutates an in-flight batch.
    const compacted = outbox.snapshots(meta.outbox, changes, meta.owner && meta.owner.epoch || 0);
    meta.outbox = compacted.outbox; changes = compacted.changes;
    meta.outbox.push({ device: meta.device, seq: meta.seq, baseRev: meta.rev, epoch: meta.owner && meta.owner.epoch || 0, changes });
    meta.observed = model.clone(current);
    save();
    emit('有记录待同步');
    const answers = meta.outbox.reduce((n, event) => n + event.changes.filter(change => change.path[1] === 'recentReviews').length, 0);
    if (answers >= 10) schedule(1);
    else schedule(Math.max(1, 60000 - (Date.now() - changedAt)));
  } finally { capturing = false; }
}
function schedule(delay) {
  const at = Math.max(Date.now() + delay, retryAt);
  if (timer && timerAt <= at) return;
  clearTimeout(timer); timerAt = at;
  timer = setTimeout(() => { timer = null; automatic(false); }, Math.max(0, at - Date.now()));
}
function automatic(check) {
  if (!meta || !meta.enabled || studyFlight) return;
  if (Date.now() < retryAt) { if (meta.outbox.length) schedule(60000); return; }
  if (meta.outbox.length || check && Date.now() - checkedAt >= 60000) flush().catch(() => {});
}
const syncTimeout = () => Object.assign(new Error('网络超时'), { code: 'SYNC_TIMEOUT' });
function waitBefore(promise, deadline) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(syncTimeout()), Math.max(0, deadline - Date.now()));
  })]).finally(() => clearTimeout(timer));
}
async function frame(data, deadline = Infinity) {
  if (!ready) throw new Error('当前微信不支持云同步');
  let timeout;
  try {
    const timeoutMs = Math.min(15000, deadline - Date.now());
    if (timeoutMs <= 0) throw syncTimeout();
    budget.reserve(meta, data.action); save();
    const result = await Promise.race([
      wx.cloud.callFunction({ name: FUNCTION, config: { env: ENV }, data: Object.assign({ protocol: model.VERSION, wireVersion: 1, device: meta.device }, data) }),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(syncTimeout()), timeoutMs); }),
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
async function request(action, data = {}, deadline) {
  try { return await wire.send(packet => frame(packet, deadline), Object.assign({ action, deltaVersion: meta.sessionBase ? 2 : 1 }, data, meta.forceFull ? { knownRev: 0 } : {})); }
  catch (error) { if (!error.syncStage) error.syncStage = action; throw error; }
}
function accept(result) {
  // A network response can beat the deferred capture timer. Capture local
  // edits before applying its acknowledgement so no recent answer is lost.
  capture();
  if (result.unchanged) {
    // Even an unchanged revision acknowledges uploads already committed by a
    // previous attempt. Keep only later local edits captured during the call.
    meta.outbox = meta.outbox.filter(event => event.seq > (result.ack || 0));
    meta.owner = result.owner;
    meta.lastSyncedAt = Date.now();
    clearBackoff();
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
  const base = model.clone(previous);
  if (result.delta && result.delta.format === 2) {
    if (!meta.sessionBase) throw new Error('missing-session-delta-base');
    base.session = model.clone(meta.sessionBase.session);
    base.practiceSession = model.clone(meta.sessionBase.practiceSession);
  }
  const combined = result.delta ? model.overlay(base, result.delta.changes) : model.clone(result.bundle);
  const sessionBase = { session: model.clone(combined.session || null), practiceSession: model.clone(combined.practiceSession || null) };
  remaining.forEach(event => model.apply(combined, event, { owner: result.owner }));
  storage.write(BEFORE_KEY, { at: Date.now(), bundle: previous });
  try { store.replaceBundle(combined); }
  catch (error) { error.syncStage = 'apply'; throw error; }
  dataRevision++;
  meta.outbox = remaining;
  meta.observed = model.clone(combined);
  meta.rev = result.rev;
  meta.owner = result.owner;
  meta.sessionBase = sessionBase;
  delete meta.forceFull;
  meta.enabled = true;
  meta.lastSyncedAt = Date.now();
  clearBackoff();
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
      const batch = wire.batch(meta.outbox);
      if (batch.length) emit('正在同步');
      const result = await request('sync', { events: batch, knownRev: meta.rev });
      if (!result.exists) throw new Error('云端存档不存在，本机记录已保留');
      accept(result);
      clearBackoff();
      if (meta.outbox.length) schedule(1000);
      return true;
    } catch (error) {
      failed(error, 'apply', '同步未成功，本地记录已保存');
      if (!errors.isQuota(error) && !['SYNC_DAILY_BUDGET', 'SYNC_PACKET_BUDGET'].includes(error.code)) retryAt = Date.now() + Math.min(900000, 60000 * Math.pow(2, Math.min(failures++, 4)));
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
    const changes = model.fineDiff(local, store.bundle());
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
async function handoffStudy() {
  // A known local owner can resume immediately, including offline. Background
  // verification still blocks answers if a different device has taken over.
  if (meta && meta.enabled && meta.owner && meta.owner.device === meta.device) {
    automatic(true);
    return true;
  }
  const deadline = Date.now() + HANDOFF_TIMEOUT;
  try {
    if (connecting) await waitBefore(connecting, deadline);
    if (!meta || !meta.enabled) return true; // Offline local learning remains usable.
    if (quotaPaused()) {
      if (blocked()) wx.showToast({ title: '同步暂缓，暂无法接续另一台设备任务', icon: 'none' });
      return !blocked();
    }
    if (flight) await waitBefore(flight, deadline);
    capture();
    while (meta.outbox.length) {
      if (Date.now() >= deadline) throw syncTimeout();
      const first = meta.outbox[0].seq;
      await waitBefore(flush(), deadline);
      if (meta.outbox[0] && meta.outbox[0].seq === first) throw Object.assign(new Error('待传记录未获确认'), { code: 'SYNC_NO_PROGRESS' });
    }
    const result = await request('claim', { knownRev: meta.rev }, deadline);
    accept(result);
    return true;
  } catch (error) {
    failed(error, 'claim', '接续未完成，本地记录已保留');
    if (error.code === 'SYNC_NO_PROGRESS') retryAt = Math.max(retryAt, Date.now() + 60000);
    if (connecting) {
      wx.showToast({ title: '学习记录仍在同步，请稍后重试', icon: 'none' });
      return false;
    }
    if (blocked()) {
      wx.showToast({ title: error.code === 'SYNC_TIMEOUT' ? '接续超时，请稍后重试' : '需联网接续另一台设备的任务', icon: 'none' });
      return false;
    }
    return true; // Known local owner can continue offline, then upload its answers.
  }
}
function beginStudy() {
  if (!studyFlight) studyFlight = handoffStudy().finally(() => {
    studyFlight = null;
    if (active && meta && meta.outbox.length) schedule(1000);
  });
  return studyFlight;
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
    store.onChange(captureSoon);
    if (meta.enabled) automatic(true);
    else if (!quotaPaused()) {
      connecting = connect(false).catch(error => failed(error, 'status', '尚未连接云端，点击重试')).finally(() => { connecting = null; });
    }
  } catch (error) { ready = false; failed(error, 'init', '云同步暂不可用，本地记录已保留'); }
}
function foreground(online) { active = true; if (online && !quotaPaused()) { retryAt = 0; failures = 0; } if (!ready) start(); else automatic(true); }
function background() { active = false; try { capture(); } catch (error) { failed(error, 'local', '本机同步队列未保存，请勿清缓存'); } if (meta && meta.enabled && meta.outbox.length) automatic(false); clearTimeout(timer); timer = null; }
function dispose() { clearTimeout(timer); clearTimeout(captureTimer); store.onChange(null); listeners.clear(); }
module.exports = { start, foreground, background, status, subscribe, enable, flush, beginStudy, blocked, capture, dispose, ENV, FUNCTION };
