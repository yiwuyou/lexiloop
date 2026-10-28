const crypto = require('crypto');
const zlib = require('zlib');
const TABLE = 'lexiloop_transfers';
const SIZE = 4000, MAX = 8 * 1024 * 1024, LIFE = 86400000;
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
module.exports = function transport({ db, read, appid, identity, handle }) {
  return async event => {
    if (event.action === 'health' || !event.wireVersion) return handle(event);
    const user = identity();
    if (!user.OPENID || user.APPID !== appid) return { ok: false, code: 'IDENTITY_REQUIRED' };
    if (event.wireVersion !== 1 || event.protocol !== 1 || !/^[a-zA-Z0-9-]{8,100}$/.test(event.device || '')) return { ok: false, code: 'PROTOCOL_MISMATCH' };
    const owner = crypto.createHash('sha256').update(`${appid}:${user.OPENID}:${event.device}`).digest('hex');
    const table = db.collection(TABLE), now = Date.now();
    const token = () => crypto.randomBytes(24).toString('hex');
    const headRef = value => {
      if (!/^[a-f0-9]{48}$/.test(value || '')) throw new Error('invalid-transfer-token');
      return table.doc(value);
    };
    async function header(value, direction) {
      const head = await read(headRef(value));
      if (!head || head.owner !== owner || head.direction !== direction || head.expires < now) throw new Error('transfer-expired-or-denied');
      return head;
    }
    async function output(result) {
      const text = JSON.stringify(result);
      if (text.length <= SIZE) return result;
      if (Buffer.byteLength(text) > MAX) throw new Error('transfer-too-large');
      const value = token(), count = Math.ceil(text.length / SIZE), expires = now + LIFE;
      // An immutable response snapshot prevents mixing two archive revisions.
      const head = { owner, expires, direction: 'download', count, length: text.length, checksum: checksum(text), payload: zlib.gzipSync(Buffer.from(text)).toString('base64') };
      await headRef(value).set({ data: head });
      return { ok: true, transfer: { token: value, count, length: head.length, checksum: head.checksum } };
    }
    try {
      if (event.action === 'wire-begin') {
        if (!Number.isInteger(event.count) || !Number.isInteger(event.length) || event.length <= SIZE || event.length > MAX || event.count !== Math.ceil(event.length / SIZE) || event.count > 2100 || !/^[a-f0-9]{1,8}$/.test(event.checksum || '')) throw new Error('invalid-transfer-size');
        // Expired temporary frames are not archives or backups. A single-field
        // expiry query uses the built-in index; no paid TTL/rollback service.
        await table.where({ expires: db.command.lt(now) }).remove().catch(() => {});
        const value = token();
        await headRef(value).set({ data: { owner, expires: now + LIFE, direction: 'upload', count: event.count, length: event.length, checksum: event.checksum } });
        return { ok: true, token: value };
      }
      if (event.action === 'wire-put') {
        const head = await header(event.token, 'upload');
        if (!Number.isInteger(event.index) || event.index < 0 || event.index >= head.count || typeof event.text !== 'string' || event.text.length !== Math.min(SIZE, head.length - event.index * SIZE)) throw new Error('invalid-transfer-part');
        // Retry is idempotent; an existing frame cannot be changed underneath
        // a commit that is concurrently reading the completed transfer.
        await db.runTransaction(async tx => {
          const target = tx.collection(TABLE).doc(`${event.token}-${event.index}`);
          const previous = await read(target);
          if (previous && previous.text !== event.text) throw new Error('transfer-part-conflict');
          if (!previous) await target.set({ data: { owner, expires: head.expires, text: event.text } });
        });
        return { ok: true };
      }
      if (event.action === 'wire-get') {
        const head = await header(event.token, 'download');
        if (!Number.isInteger(event.index) || event.index < 0 || event.index >= head.count) throw new Error('invalid-transfer-index');
        const text = zlib.gunzipSync(Buffer.from(head.payload, 'base64'), { maxOutputLength: MAX }).toString();
        return { ok: true, text: text.slice(event.index * SIZE, (event.index + 1) * SIZE) };
      }
      if (event.action === 'wire-commit') {
        const head = await header(event.token, 'upload');
        let text = '';
        for (let offset = 0; offset < head.count; offset += 16) {
          const parts = await Promise.all(Array.from({ length: Math.min(16, head.count - offset) }, (_, index) => read(table.doc(`${event.token}-${offset + index}`))));
          for (const part of parts) {
            if (!part || part.owner !== owner) throw new Error('transfer-incomplete');
            text += part.text;
          }
        }
        if (text.length !== head.length || Buffer.byteLength(text) > MAX || checksum(text) !== head.checksum) throw new Error('transfer-checksum-mismatch');
        const inner = JSON.parse(text);
        if (!['bootstrap', 'attach', 'sync', 'claim', 'status'].includes(inner.action)) throw new Error('invalid-transfer-action');
        return await output(await handle({ ...inner, device: event.device, protocol: 1 }));
      }
      if (event.action.startsWith('wire-')) throw new Error('invalid-transfer-action');
      return await output(await handle(event));
    } catch (error) {
      return { ok: false, code: /^[a-zA-Z0-9_.-]{1,100}$/.test(error.message || '') ? error.message : 'TRANSFER_ERROR', message: '分块传输未完成，本机记录已保留' };
    }
  };
};
