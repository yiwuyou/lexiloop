const store = require('./store');
const model = require('./sync-model');
const storage = require('./sync-storage');
const errors = require('./sync-error');
const wire = require('./sync-wire');
const outbox = require('./sync-outbox');
const observed = require('./sync-observed');
const budget = require('./sync-budget');
const ENV = 'lj-tx-serv-d1gw7ceh2130f8cc4';
const FUNCTION = 'lexiloop-sync';
const KEY = 'lexiloop_cloud_sync_v1';
const BEFORE_KEY = 'lexiloop_before_cloud_apply_v1';
const REPAIR_BACKUP_KEY = 'lexiloop_before_baseline_repair_v1';
const QUOTA_DELAY = 3600000;
const HANDOFF_TIMEOUT = 20000;
let meta, flight, timer, loaded = false, capturing = false, ready = false, active = true;
let timerAt = 0, checkedAt = 0, retryAt = 0, failures = 0;
let connecting = null;
let dataRevision = 0;
let studyFlight = null;
let checkPeerOnReply = false, peerTimer = null;
let captureTimer = null;
let dirtyAt = 0, pendingSaves = 0;
let allWordsDirty = true;
let baselineMissing = false;
// In-memory only. Revalidate the revision before using a prior repair read.
let repairSnapshot = null;
const repairDownload = {};
const dirtyWords = new Set();
function resetWords() { allWordsDirty = false; dirtyWords.clear(); }
function changedWordProjection(bundle) {
  if (allWordsDirty) return bundle;
  const state = Object.assign({}, bundle.state);
  ['cards', 'weakBook'].forEach(name => {
    const values = {}, source = state[name] || {};
    dirtyWords.forEach(id => { if (Object.prototype.hasOwnProperty.call(source, id)) values[id] = source[id]; });
    state[name] = values;
  });
  return Object.assign({}, bundle, { state });
}
function captureSoon(wordIds) {
  if (wordIds == null) allWordsDirty = true;
  else (Array.isArray(wordIds) ? wordIds : [wordIds]).forEach(id => dirtyWords.add(id));
  if (!meta || !meta.enabled) return;
  if (!dirtyAt) dirtyAt = Date.now();
  const changes = ++pendingSaves;
  if (changes === 1) emit('有记录待同步');
  // The answer journal is already durable. Build one cloud delta for a batch.
  if (changes !== 10 && captureTimer) return;
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => {
    captureTimer = null;
    try { capture(); automatic(false); }
    catch (error) { failed(error, 'local', '本机同步队列未保存，请勿清缓存'); }
  }, changes >= 10 ? 1 : 60000);
}
let message = '尚未开启云同步';
let lastError = null;
const listeners = new Set();
function load() {
  if (loaded) return;
  if (!meta) meta = storage.read(KEY) || {
    device: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
    enabled: false, seq: 0, rev: 0, outbox: [], lastSyncedAt: 0, owner: null,
  };
  try { observed.restore(meta); }
  catch (error) {
    if (!meta.enabled || error.message !== 'missing-observed-baseline') throw error;
    baselineMissing = true;
  }
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
  loaded = true;
}
function save(checkpoint = false) { observed.save(meta, checkpoint); }
function status() {
  if (!meta) return { dataRevision, text: message, enabled: false, pending: 0, last: '', busy: false, errorText: errors.format(lastError) };
  const date = new Date(meta.lastSyncedAt || 0);
  return {
    dataRevision, text: message, enabled: meta.enabled, needsCloudRead: lastError && lastError.code === 'SYNC_BASELINE_DIVERGED', pending: meta.outbox.length + (dirtyAt ? 1 : 0), busy: !!flight,
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
  if (ready && /^(queue-delta-(base-mismatch|checksum)|missing-session-delta-base|sync-delta-base-mismatch)$/.test(error.message || '')) {
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
  if (!dirtyAt && !allWordsDirty) return;
  const changedAt = dirtyAt || Date.now();
  pendingSaves = 0;
  clearTimeout(captureTimer); captureTimer = null;
  if (!ready || baselineMissing || !meta || !meta.enabled || capturing) return;
  capturing = true;
  const captureStarted = Date.now();
  try {
    const current = store.bundle();
    let changes = model.fineDiff(changedWordProjection(meta.observed || current), changedWordProjection(current));
    if (!changes.length) {
      dirtyAt = 0;
      resetWords();
      if (!meta.outbox.length && message === '有记录待同步' && meta.lastSyncedAt) emit('已同步');
      return;
    }
    const previousOutbox = meta.outbox, previousObserved = meta.observed;
    meta.seq++;
    // A growing day's timing/task maps must not be resent for every pending
    // checkpoint. Preserve the first preimage and last image, plus all event
    // IDs/answers. The pure helper never mutates an in-flight batch.
    const compacted = outbox.snapshots(meta.outbox, changes, meta.owner && meta.owner.epoch || 0);
    meta.outbox = compacted.outbox; changes = compacted.changes;
    meta.outbox.push({ device: meta.device, seq: meta.seq, baseRev: meta.rev, epoch: meta.owner && meta.owner.epoch || 0, changes });
    observed.mark(changes);
    // store.bundle returns an isolated snapshot; keep it instead of copying it twice.
    meta.observed = current;
    try { save(); }
    catch (error) {
      meta.observed = previousObserved;
      meta.outbox = previousOutbox;
      meta.seq--;
      throw error;
    }
    dirtyAt = 0;
    resetWords();
    emit('有记录待同步');
    const answers = meta.outbox.reduce((n, event) => n + event.changes.filter(change => change.path[1] === 'recentReviews').length, 0);
    if (answers >= 10) schedule(1);
    else schedule(Math.max(1, 60000 - (Date.now() - changedAt)));
  } finally { capturing = false; require('./interaction-trace').record('sync.capture', captureStarted); }
}
function schedule(delay) {
  const at = Math.max(Date.now() + delay, retryAt);
  if (timer && timerAt <= at) return;
  clearTimeout(timer); timerAt = at;
  timer = setTimeout(() => { timer = null; automatic(false); }, Math.max(0, at - Date.now()));
}
function automatic(check) {
  if (!ready || baselineMissing || !meta || !meta.enabled || studyFlight) return;
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
  if (!ready) throw Object.assign(new Error('本机云连接尚未初始化'), { code: 'SYNC_NOT_READY', syncStage: 'init' });
  let timeout;
  try {
    const reading = data.action === 'status' || data.action === 'wire-get';
    const timeoutMs = Math.min(reading ? 30000 : 15000, deadline - Date.now());
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
async function request(action, data = {}, deadline, options) {
  try { return await wire.send(packet => frame(packet, deadline), Object.assign({ action, deltaVersion: meta.sessionBase ? 2 : 1 }, data, meta.forceFull ? { knownRev: 0 } : {}), options); }
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
  const localUnchanged = JSON.stringify(previous) === JSON.stringify(combined);
  if (!localUnchanged) {
    if (missingLearned(previous, combined)) throw recoveryError('SYNC_LEARNED_CONFLICT', '云端结果缺少本机已学词，已保留本机记录');
    storage.write(BEFORE_KEY, { at: Date.now(), bundle: previous });
    try { store.replaceBundle(combined); }
    catch (error) { error.syncStage = 'apply'; throw error; }
    dataRevision++;
  }
  meta.outbox = remaining;
  meta.observed = model.clone(combined);
  meta.rev = result.rev;
  meta.owner = result.owner;
  meta.sessionBase = sessionBase;
  delete meta.forceFull;
  meta.enabled = true;
  meta.lastSyncedAt = Date.now();
  clearBackoff();
  save(baselineMissing || !localUnchanged);
  lastError = null;
  emit(remaining.length ? '有记录待同步' : '已同步');
}
function recoveryError(code, message) {
  return Object.assign(new Error(message), { code, syncStage: 'repair' });
}

function learnedIds(bundle) {
  const { canonicalId } = require('./word-identity');
  return new Set(Object.keys(bundle.state.cards).filter(id => bundle.state.cards[id].seen).map(canonicalId));
}
function missingLearned(source, destination) {
  const available = learnedIds(destination);
  return Array.from(learnedIds(source)).some(id => !available.has(id));
}
async function recoverBaseline(preferCloud, deadline) {
  emit('正在核对本机与云端存档');
  let result = await request('status', { knownRev: repairSnapshot ? repairSnapshot.rev : 0, deltaVersion: 0 }, deadline, { downloadCache: repairDownload });
  if (result.unchanged && repairSnapshot && result.rev === repairSnapshot.rev) {
    result = Object.assign({}, result, { bundle: repairSnapshot.bundle });
    delete result.unchanged;
  }
  if (!result.exists || !model.valid(result.bundle) || !Number.isSafeInteger(result.rev) || result.rev < meta.rev
    || !Number.isSafeInteger(result.ack) || result.ack < 0) {
    throw recoveryError('SYNC_BASELINE_UNVERIFIED', '云端存档无法用来校验本机记录');
  }
  const pending = meta.outbox.filter(event => event.seq > result.ack);
  const contiguous = pending.length === meta.seq - result.ack
    && pending.every((event, index) => event.seq === result.ack + index + 1 && event.device === meta.device);
  if (!contiguous) throw recoveryError('SYNC_BASELINE_UNVERIFIED', '无法核对待上传记录的顺序');
  repairSnapshot = { rev: result.rev, bundle: result.bundle };
  const local = store.bundle();

  // At the same cloud revision, acknowledged state plus queued local writes
  // reconstructs the comparison point. Normal capture can then see fresh edits.
  if (result.rev === meta.rev) {
    try {
      const anchor = model.clone(result.bundle);
      pending.forEach(event => model.overlay(anchor, event.changes));
      // Even an equal revision cannot prove a damaged desktop kept every card.
      // Never turn cloud-only learned words into inferred local deletions.
      if (!missingLearned(result.bundle, anchor) && !missingLearned(anchor, local)) meta.observed = anchor;
    } catch (error) {
      if (!preferCloud) throw recoveryError('SYNC_BASELINE_DIVERGED', '无法用云端和待传记录重建本机同步基准');
    }
    if (meta.observed) {
      meta.sessionBase = { session: result.bundle.session || null, practiceSession: result.bundle.practiceSession || null };
      try { save(true); }
      catch (error) { delete meta.observed; throw error; }
      baselineMissing = false;
      repairSnapshot = null;
      capture();
      // A verified current snapshot already serves as the acknowledgement.
      if (!meta.outbox.some(event => event.seq > result.ack)) {
        accept({ ...result, unchanged: true });
        return true;
      }
      return false;
    }
  }
  if (!preferCloud) throw recoveryError('SYNC_BASELINE_DIVERGED',
    '本机已学 ' + learnedIds(local).size + ' 词，云端已学 ' + learnedIds(result.bundle).size + ' 词，请核对后接回');

  // Send only the durable outbox, then save a separate local copy before
  // applying the cloud snapshot. An unknown difference never becomes an upload.
  // Inspect the same pending operations before sending any of them.
  const projected = model.clone(result.bundle);
  pending.forEach(event => model.apply(projected, event, { owner: result.owner }));
  if (missingLearned(result.bundle, projected) || missingLearned(local, projected)) {
    throw recoveryError('SYNC_LEARNED_CONFLICT', '合并会遗漏已学词，已保留两端存档');
  }
  let remaining = pending;
  for (let i = 0; remaining.length && i < 8; i++) {
    const next = await request('sync', { events: wire.batch(remaining), knownRev: result.rev }, deadline);
    if (!next.exists || !Number.isSafeInteger(next.ack) || next.ack <= result.ack || next.ack > meta.seq) throw recoveryError('SYNC_NO_PROGRESS', '待上传记录未收到确认');
    if (!next.bundle) {
      if (!next.delta || next.delta.baseRev !== result.rev) throw recoveryError('SYNC_BASELINE_UNVERIFIED', '云端返回的版本无法接续');
      next.bundle = model.overlay(model.clone(result.bundle), next.delta.changes);
      delete next.delta;
    }
    if (!model.valid(next.bundle)) throw recoveryError('SYNC_BASELINE_UNVERIFIED', '云端记录格式无法校验');
    result = next;
    remaining = remaining.filter(event => event.seq > result.ack);
  }
  if (remaining.length) throw recoveryError('SYNC_NO_PROGRESS', '仍有待上传记录，请再试一次');
  // If a local edit was made during recovery, keep it in place for a new pass.
  if (!model.equal(local, store.bundle())) throw recoveryError('SYNC_BASELINE_DIVERGED', '恢复期间本机记录有变化，请重新确认');
  if (missingLearned(local, result.bundle)) throw recoveryError('SYNC_LEARNED_CONFLICT', '云端仍缺少本机已学词，已保留本机记录');
  if (!model.equal(local, result.bundle)) storage.write(REPAIR_BACKUP_KEY, local);
  accept(result);
  baselineMissing = false;
  repairSnapshot = null;
  return true;
}

async function flush({ preferCloud = false, repairDeadline = Infinity } = {}) {
  if (flight) return flight;
  if (!meta || !meta.enabled) return false;
  if (!ready) {
    try { initialize(); }
    catch (error) { failed(error, 'init', '云同步暂不可用，本地记录已保留'); throw error; }
  }
  try { capture(); } catch (error) { failed(error, 'local', '本机同步队列未保存，请勿清缓存'); throw error; }
  clearTimeout(timer); timer = null;
  flight = (async () => {
    try {
      checkedAt = Date.now();
      if (baselineMissing && await recoverBaseline(preferCloud, repairDeadline)) return true;
      let batches = 0, uploaded;
      do {
        const batch = wire.batch(meta.outbox);
        emit(batch.length ? '正在同步' : '正在核对云端进度');
        const result = await request('sync', { events: batch, knownRev: meta.rev });
        if (!result.exists) throw new Error('云端存档不存在，本机记录已保留');
        accept(result);
        if (checkPeerOnReply) {
          checkPeerOnReply = false;
          if (active && blocked() && result.unchanged && !peerTimer) {
            // The other device can still be finishing its exit upload.
            peerTimer = setTimeout(() => {
              peerTimer = null;
              if (active && blocked() && !flight && !studyFlight && Date.now() >= retryAt) flush().catch(() => {});
            }, 5000);
          }
        }
        uploaded = !batch.length || result.ack >= batch[batch.length - 1].seq;
      } while (!active && uploaded && meta.outbox.length && ++batches < 8);
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
  try {
    initialize();
    return await connect(true);
  } catch (error) {
    failed(error, 'apply', '未能完成同步，本地记录已保留');
    throw error;
  }
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
    if (baselineMissing) await waitBefore(flush({ repairDeadline: deadline }), deadline);
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
function initialize() {
  if (ready) return;
  try {
    load();
    if (!meta.observed && !baselineMissing) meta.observed = store.bundle();
  } catch (error) {
    throw Object.assign(error, { syncStage: 'local-read' });
  }
  try {
    if (!wx.cloud || typeof wx.cloud.init !== 'function' || typeof wx.cloud.callFunction !== 'function') {
      throw Object.assign(new Error('本次运行缺少微信云开发接口'), { code: 'SYNC_UNSUPPORTED' });
    }
    wx.cloud.init({ env: ENV, traceUser: false });
  } catch (error) {
    throw Object.assign(error, { syncStage: 'init' });
  }
  try { if (!baselineMissing) save(); }
  catch (error) { throw Object.assign(error, { syncStage: 'local' }); }
  ready = true;
  store.onChange(captureSoon);
}
function start() {
  if (ready) return;
  try {
    initialize();
    if (baselineMissing) {
      failed(recoveryError('SYNC_BASELINE_MISSING', '本机同步比对存档不可用'), 'repair', '同步可修复，本机记录已保留');
    } else if (meta.enabled) { checkPeerOnReply = true; automatic(true); }
    else if (!quotaPaused()) {
      connecting = connect(false).catch(error => failed(error, 'status', '尚未连接云端，点击重试')).finally(() => { connecting = null; });
    }
  } catch (error) { failed(error, 'init', '云同步暂不可用，本地记录已保留'); }
}
function foreground(online) {
  const resumed = !active;
  active = true;
  if (online && !quotaPaused()) { retryAt = 0; failures = 0; }
  if (resumed || online) { checkedAt = 0; checkPeerOnReply = true; }
  if (!ready) start();
  else if (resumed && flight) {
    // An old in-flight read may have sampled the cloud before the PC finished.
    flight.then(() => { if (active) { checkedAt = 0; automatic(true); } }, () => {});
  } else automatic(true);
}
function background() {
  active = false;
  clearTimeout(peerTimer); peerTimer = null; checkPeerOnReply = false;
  clearTimeout(timer); timer = null;
  try { capture(); } catch (error) { failed(error, 'local', '本机同步队列未保存，请勿清缓存'); }
  if (meta && meta.enabled && meta.outbox.length) automatic(false);
  // Fold only after starting the upload. Suspension is safe: the journal is durable.
  const checkpoint = () => { if (!active) { try { store.flushAnswers(); } catch (_) { /* retry on the next exit */ } } };
  if (flight) flight.then(checkpoint, checkpoint);
  else setTimeout(checkpoint, 0);
}
function dispose() { clearTimeout(peerTimer); clearTimeout(timer); clearTimeout(captureTimer); store.onChange(null); listeners.clear(); }
module.exports = { hasRepairBackup: () => Boolean(wx.getStorageSync(REPAIR_BACKUP_KEY)),
  repairBackup: () => storage.read(REPAIR_BACKUP_KEY), start, foreground, background, status, subscribe, enable, flush, beginStudy, blocked, capture, dispose, ENV, FUNCTION };
