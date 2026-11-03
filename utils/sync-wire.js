// Small JSON frames work across phone/desktop gateway limits. No cloud archive
// is acknowledged until every frame has arrived and its checksum is verified.
const SIZE = 4000;
const MAX = 8 * 1024 * 1024, ENCODING = 'gzip-base64';
let codec;
const compression = () => codec || (codec = require('./sync-codec'));
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
async function parts(count, task) {
  for (let offset = 0; offset < count; offset += 4) {
    // Finish an already-started group before exposing a failure. A retry must
    // not overlap writes from an abandoned group or leave rejected promises.
    const results = await Promise.all(Array.from({ length: Math.min(4, count - offset) }, async (_, index) => {
      try { await task(offset + index); return null; } catch (error) { return { error }; }
    }));
    const failed = results.find(result => result);
    if (failed) throw failed.error;
  }
}
async function send(call, event, options = {}) {
  const maxFrames = options.maxFrames || 128;
  const text = JSON.stringify(options.compress === false ? event : Object.assign({}, event, { responseEncoding: ENCODING }));
  // Conservative UTF-8 upper bound (surrogate pairs count as six bytes).
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) bytes += text.charCodeAt(i) > 2047 ? 2 : text.charCodeAt(i) > 127 ? 1 : 0;
  let result;
  if (bytes <= 24000) result = await call(JSON.parse(text));
  else {
    const packed = options.compress === false ? null : compression().pack(text);
    const useful = packed && packed.data.length < bytes && packed.data.length <= MAX;
    if (useful && JSON.stringify({ action: 'wire-packed', packed }).length <= 24000) {
      result = await call({ action: 'wire-packed', packed });
    } else {
      const body = useful ? packed.data : text;
      const count = Math.ceil(body.length / SIZE);
      if (count + 2 > maxFrames) throw Object.assign(new Error('本次同步数据超过传输保护上限，记录已保留'), { code: 'SYNC_PACKET_BUDGET' });
      const metadata = useful ? { encoding: ENCODING, decodedLength: packed.length, decodedChecksum: packed.checksum } : {};
      const head = await call(Object.assign({ action: 'wire-begin', count, length: body.length, checksum: checksum(body) }, metadata));
      await parts(count, index => call({ action: 'wire-put', token: head.token, index, text: body.slice(index * SIZE, (index + 1) * SIZE) }));
      result = await call({ action: 'wire-commit', token: head.token });
    }
  }
  if (result && result.packed) result = JSON.parse(compression().unpack(result.packed));
  if (!result) throw new Error('invalid-transfer-result');
  if (!result.transfer) {
    if (!result || !result.ok) throw new Error('invalid-transfer-result');
    return result;
  }
  const head = result.transfer;
  if (head.count > maxFrames) throw Object.assign(new Error('本次同步下载超过传输保护上限，未覆盖本机记录'), { code: 'SYNC_PACKET_BUDGET' });
  if (!Number.isInteger(head.count) || head.count < 1 || head.count > 2100
    || !Number.isInteger(head.length) || head.length < 1 || head.length > MAX
    || head.count !== Math.ceil(head.length / SIZE) || head.encoding && head.encoding !== ENCODING) throw new Error('invalid-transfer');
  const chunks = new Array(head.count);
  await parts(head.count, async index => {
    const part = await call({ action: 'wire-get', token: head.token, index });
    if (typeof part.text !== 'string' || part.text.length > SIZE) throw new Error('invalid-transfer-part');
    chunks[index] = part.text;
  });
  const joined = chunks.join('');
  if (joined.length !== head.length || checksum(joined) !== head.checksum) throw new Error('transfer-checksum-mismatch');
  result = JSON.parse(head.encoding ? compression().unpack({ encoding: head.encoding, data: joined, length: head.decodedLength, checksum: head.decodedChecksum }) : joined);
  if (!result || !result.ok) throw new Error('invalid-transfer-result');
  return result;
}
module.exports = { send, checksum };
