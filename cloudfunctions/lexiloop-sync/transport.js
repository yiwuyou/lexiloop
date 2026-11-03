const crypto = require('crypto');
const zlib = require('zlib');
const TABLE = 'lexiloop_transfers';
const SIZE = 4000, MAX = 8 * 1024 * 1024, LIFE = 86400000;
const ENCODING = 'gzip-base64';
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function unpackPacked(value) {
  if (!value || value.encoding !== ENCODING || !Number.isInteger(value.length) || value.length < 1 || value.length > MAX
    || typeof value.data !== 'string' || value.data.length > MAX || value.data.length % 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || !/^[a-f0-9]{1,8}$/.test(value.checksum || '')) throw new Error('invalid-packed-data');
  const bytes = zlib.gunzipSync(Buffer.from(value.data, 'base64'), { maxOutputLength: MAX });
  if (bytes.length !== value.length) throw new Error('packed-length-mismatch');
  const text = bytes.toString('utf8');
  if (checksum(text) !== value.checksum) throw new Error('transfer-checksum-mismatch');
  return text;
}
module.exports = function transport({ db, read, appid, identity, handle }) {
  return async event => {
    if (event.action === 'health' || !event.wireVersion) return handle(event);
    const user = identity();
    if (!user.OPENID || user.APPID !== appid) return { ok: false, code: 'IDENTITY_REQUIRED' };
    if (event.wireVersion !== 1 || event.protocol !== require('./model.generated').VERSION || !/^[a-zA-Z0-9-]{8,100}$/.test(event.device || '')) return { ok: false, code: 'PROTOCOL_MISMATCH', message: '请将手机和电脑都更新到新版小程序后同步' };
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
    async function output(result, compact) {
      const text = JSON.stringify(result);
      if (Buffer.byteLength(text) <= 24000) return result;
      if (Buffer.byteLength(text) > MAX) throw new Error('transfer-too-large');
      const payload = zlib.gzipSync(Buffer.from(text)).toString('base64');
      const packed = compact && payload.length < Buffer.byteLength(text)
        ? { encoding: ENCODING, data: payload, length: Buffer.byteLength(text), checksum: checksum(text) } : null;
      if (packed && Buffer.byteLength(JSON.stringify({ ok: true, packed })) <= 24000) return { ok: true, packed };
      const body = packed ? payload : text;
      const value = token(), count = Math.ceil(body.length / SIZE), expires = now + LIFE;
      // An immutable response snapshot prevents mixing two archive revisions.
      const metadata = packed ? { encoding: ENCODING, decodedLength: packed.length, decodedChecksum: packed.checksum } : {};
      const head = { owner, expires, direction: 'download', count, length: body.length, checksum: checksum(body), payload, ...metadata };
      await headRef(value).set({ data: head });
      return { ok: true, transfer: { token: value, count, length: head.length, checksum: head.checksum, ...metadata } };
    }
    async function inner(text) {
      const data = JSON.parse(text);
      if (!['bootstrap', 'attach', 'sync', 'claim', 'status'].includes(data.action)) throw new Error('invalid-transfer-action');
      return output(await handle({ ...data, device: event.device, protocol: require('./model.generated').VERSION }), data.responseEncoding === ENCODING);
    }
    try {
      if (event.action === 'wire-packed') {
        if (!event.packed || typeof event.packed.data !== 'string' || event.packed.data.length > 24000) throw new Error('invalid-packed-data');
        return await inner(unpackPacked(event.packed));
      }
      if (event.action === 'wire-begin') {
        if (!Number.isInteger(event.count) || !Number.isInteger(event.length) || event.length <= SIZE || event.length > MAX || event.count !== Math.ceil(event.length / SIZE) || event.count > 2100 || !/^[a-f0-9]{1,8}$/.test(event.checksum || '')) throw new Error('invalid-transfer-size');
        // Expired temporary frames are not archives or backups. A single-field
        // expiry query uses the built-in index; no paid TTL/rollback service.
        await table.where({ expires: db.command.lt(now) }).remove().catch(() => {});
        const value = token();
        if (event.encoding && (event.encoding !== ENCODING || !Number.isInteger(event.decodedLength) || event.decodedLength < 1 || event.decodedLength > MAX
          || !/^[a-f0-9]{1,8}$/.test(event.decodedChecksum || ''))) throw new Error('invalid-packed-data');
        const metadata = event.encoding ? { encoding: ENCODING, decodedLength: event.decodedLength, decodedChecksum: event.decodedChecksum } : {};
        await headRef(value).set({ data: { owner, expires: now + LIFE, direction: 'upload', count: event.count, length: event.length, checksum: event.checksum, ...metadata } });
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
        const text = head.encoding ? head.payload : zlib.gunzipSync(Buffer.from(head.payload, 'base64'), { maxOutputLength: MAX }).toString();
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
        return await inner(head.encoding ? unpackPacked({ encoding: head.encoding, data: text, length: head.decodedLength, checksum: head.decodedChecksum }) : text);
      }
      if (event.action.startsWith('wire-')) throw new Error('invalid-transfer-action');
      return await output(await handle(event), event.responseEncoding === ENCODING);
    } catch (error) {
      return { ok: false, code: /^[a-zA-Z0-9_.-]{1,100}$/.test(error.message || '') ? error.message : 'TRANSFER_ERROR', message: '分块传输未完成，本机记录已保留' };
    }
  };
};
