// Offline gzip transport only. No model fields, credentials or network calls.
const fflate = require('../vendor/fflate/index');
const MAX = 8 * 1024 * 1024;
const ENCODING = 'gzip-base64';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function base64(bytes) {
  const parts = [];
  for (let start = 0; start < bytes.length; start += 12000) {
    let text = '';
    for (let i = start; i < Math.min(start + 12000, bytes.length); i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      text += alphabet[a >> 2] + alphabet[(a & 3) << 4 | (b || 0) >> 4]
        + (i + 1 < bytes.length ? alphabet[(b & 15) << 2 | (c || 0) >> 6] : '=')
        + (i + 2 < bytes.length ? alphabet[c & 63] : '=');
    }
    parts.push(text);
  }
  return parts.join('');
}
function unbase64(text) {
  if (typeof text !== 'string' || text.length > MAX || !text.length || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('invalid-packed-data');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(text.length / 4 * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = alphabet.indexOf(text[i]) << 18 | alphabet.indexOf(text[i + 1]) << 12
      | Math.max(0, alphabet.indexOf(text[i + 2])) << 6 | Math.max(0, alphabet.indexOf(text[i + 3]));
    if (at < bytes.length) bytes[at++] = n >>> 16;
    if (at < bytes.length) bytes[at++] = n >>> 8 & 255;
    if (at < bytes.length) bytes[at++] = n & 255;
  }
  return bytes;
}
function pack(text) {
  const bytes = fflate.strToU8(text);
  if (!bytes.length || bytes.length > MAX) throw new Error('sync-payload-too-large');
  return { encoding: ENCODING, data: base64(fflate.gzipSync(bytes, { level: 1, mtime: 0 })), length: bytes.length, checksum: checksum(text) };
}
function unpack(value) {
  if (!value || value.encoding !== ENCODING || !Number.isInteger(value.length) || value.length < 1 || value.length > MAX
    || !/^[a-f0-9]{1,8}$/.test(value.checksum || '')) throw new Error('invalid-packed-data');
  const bytes = unbase64(value.data);
  if (bytes.length < 18 || bytes[0] !== 31 || bytes[1] !== 139 || bytes[2] !== 8) throw new Error('invalid-packed-data');
  const end = bytes.length;
  const declared = (bytes[end - 4] | bytes[end - 3] << 8 | bytes[end - 2] << 16 | bytes[end - 1] << 24) >>> 0;
  if (declared !== value.length) throw new Error('packed-length-mismatch');
  // Bound the allocation before inflating, including a forged gzip footer.
  const result = fflate.gunzipSync(bytes, { out: new Uint8Array(value.length) });
  if (result.length !== value.length) throw new Error('packed-length-mismatch');
  const text = fflate.strFromU8(result);
  if (checksum(text) !== value.checksum) throw new Error('transfer-checksum-mismatch');
  return text;
}
module.exports = { pack, unpack, checksum, ENCODING, MAX };
