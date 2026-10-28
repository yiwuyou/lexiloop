const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const zlib = require('zlib');
const model = require('./model.generated');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const APPID = 'wxee41f64becac8cf2';
const RECORDS = 'lexiloop_sync';
const SNAPSHOTS = 'lexiloop_snapshots';
const pack = value => zlib.gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
const unpack = value => JSON.parse(zlib.gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: 8 * 1024 * 1024 }).toString());
const dateKey = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
function checkBundle(bundle) {
  if (!model.valid(bundle) || JSON.stringify(bundle).length > 2000000 || Object.keys(bundle.state.cards).length > 3000) throw new Error('invalid-bundle');
}
async function read(ref) {
  try {
    const result = await ref.get();
    return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
  } catch (error) {
    if (/document.*(not exist|not found)|document_not_exist/i.test(error.errMsg || error.message || '')) return null;
    throw error; // Never interpret a network/permission error as an empty cloud.
  }
}
function reply(record, device, knownRev) {
  if (!record) return { ok: true, exists: false, protocol: model.VERSION };
  const result = { ok: true, exists: true, protocol: model.VERSION, rev: record.rev, owner: record.owner, ack: record.acks[device] || 0 };
  if (knownRev === record.rev) result.unchanged = true;
  else result.bundle = record.bundle;
  return result;
}
exports.main = async event => {
  // Safe deployment diagnostic: no user records, identifiers or writes.
  if (event.action === 'health') {
    let step = 'collections';
    try {
      await Promise.all([RECORDS, SNAPSHOTS].map(name => db.collection(name).limit(1).field({ _id: true }).get()));
      step = 'transaction-read';
      await db.runTransaction(async transaction => {
        await read(transaction.collection(RECORDS).doc('deployment-health-readonly'));
        return true;
      });
      return { ok: true, protocol: model.VERSION, appid: APPID, name: 'lexiloop-sync', storageReady: true, transactionReady: true };
    } catch (error) {
      return { ok: false, storageReady: step !== 'collections', step, code: String(error.code || error.errCode || error.name || 'UNKNOWN'), detail: String(error.errMsg || error.message || '').replace(/[a-f0-9]{32,}/gi, '[id]').slice(0, 300) };
    }
  }
  const identity = cloud.getWXContext();
  if (!identity.OPENID || identity.APPID !== APPID) return { ok: false, code: 'IDENTITY_REQUIRED', message: '云函数未取得词序小程序的微信身份' };
  if (event.protocol !== model.VERSION || !/^[a-zA-Z0-9-]{8,100}$/.test(event.device || '')) return { ok: false, code: 'PROTOCOL_MISMATCH', message: '请更新小程序后重试' };
  const id = crypto.createHash('sha256').update(`${APPID}:${identity.OPENID}`).digest('hex');
  const ref = db.collection(RECORDS).doc(id);
  const now = Date.now();
  let step = event.action;
  try {
    if (event.action === 'status' || event.action === 'sync' && (!event.events || !event.events.length)) {
      const row = await read(ref);
      return reply(row && unpack(row.payload), event.device, event.knownRev);
    }
    if (!['bootstrap', 'attach', 'sync', 'claim'].includes(event.action)) throw new Error('invalid-action');
    if (['bootstrap', 'attach'].includes(event.action)) checkBundle(event.bundle);
    const transactionResult = await db.runTransaction(async transaction => {
      step = 'transaction-read';
      const target = transaction.collection(RECORDS).doc(id);
      const row = await read(target);
      let record = row && unpack(row.payload);
      if (event.action === 'bootstrap') {
        if (record) return reply(record, event.device); // First-writer-wins; never overwrite an existing archive.
        if (!model.learned(event.bundle)) throw new Error('empty-bootstrap');
        record = { bundle: event.bundle, acks: {}, versions: {}, rev: 1, owner: { device: event.device, epoch: 1 } };
      } else {
        if (!record) return reply(null, event.device);
        if (record.rev >= 1000000000) throw new Error('invalid-revision');
        if (event.action === 'attach') {
          const merged = model.attach(record.bundle, event.bundle);
          // Preserve deletion tombstones when an old, never-linked device joins.
          ['weakBook', 'sentenceBook'].forEach(name => Object.keys(merged.state[name] || {}).forEach(key => {
            if (!record.bundle.state[name] || !record.bundle.state[name][key]) {
              if (record.versions[JSON.stringify(['state', name, key])]) delete merged.state[name][key];
            }
          }));
          record.bundle = merged;
        }
        if (event.action === 'claim') record.owner = { device: event.device, epoch: (record.owner && record.owner.epoch || 0) + 1 };
        if (event.action === 'sync') {
          if (!Array.isArray(event.events) || event.events.length > 20) throw new Error('invalid-events');
          for (const item of event.events) {
            if (item.device !== event.device || !Number.isSafeInteger(item.seq) || item.seq < 1) throw new Error('invalid-event-id');
            const ack = record.acks[event.device] || 0;
            if (item.seq <= ack) continue;
            if (item.seq !== ack + 1) throw new Error('out-of-order-event');
            model.apply(record.bundle, item, { versions: record.versions, nextRev: record.rev + 1, owner: record.owner });
            record.acks[event.device] = item.seq;
          }
        }
        record.rev++;
      }
      checkBundle(record.bundle);
      const today = dateKey(now);
      // Independent compressed documents avoid exceeding a single-document
      // size limit. No managed/paid database rollback feature is required.
      if (record.snapshotDay !== today) {
        step = 'snapshot-write';
        await transaction.collection(SNAPSHOTS).doc(`${id}-${today}`).set({ data: { owner: id, day: today, payload: pack(record.bundle), at: now } });
        record.snapshotDay = today;
      }
      step = 'record-write';
      await target.set({ data: { payload: pack(record), updatedAt: now, protocol: model.VERSION } });
      step = 'transaction-commit';
      return reply(record, event.device);
    });
    // wx-server-sdk versions may wrap the transaction callback result.
    const result = transactionResult && transactionResult.result || transactionResult;
    // Rolling seven-day backups: delete only this user's older snapshots.
    if (result && result.ok && result.exists) {
      await db.collection(SNAPSHOTS).where({ owner: id, day: db.command.lt(dateKey(now - 6 * 86400000)) }).remove().catch(() => {});
    }
    return result;
  } catch (error) {
    const candidate = String(error.code || error.errCode || error.message || error.name || 'SYNC_ERROR');
    const code = /^[a-zA-Z0-9_.-]{1,100}$/.test(candidate) ? candidate : 'SYNC_ERROR';
    console.error('sync failed', step, code);
    return { ok: false, code, step, message: '云端操作未完成，本机记录未清除' };
  }
};
