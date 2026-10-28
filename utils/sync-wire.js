// Small JSON frames work across phone/desktop gateway limits. No cloud archive
// is acknowledged until every frame has arrived and its checksum is verified.
const SIZE = 4000;
function checksum(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
async function parts(count, task) {
  for (let offset = 0; offset < count; offset += 4) {
    await Promise.all(Array.from({ length: Math.min(4, count - offset) }, (_, index) => task(offset + index)));
  }
}
async function send(call, event) {
  const text = JSON.stringify(event);
  // Conservative UTF-8 upper bound (surrogate pairs count as six bytes).
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) bytes += text.charCodeAt(i) > 2047 ? 2 : text.charCodeAt(i) > 127 ? 1 : 0;
  let result;
  if (bytes <= 24000) result = await call(event);
  else {
    const count = Math.ceil(text.length / SIZE);
    if (count > 2100) throw new Error('sync-payload-too-large');
    const head = await call({ action: 'wire-begin', count, length: text.length, checksum: checksum(text) });
    await parts(count, index => call({ action: 'wire-put', token: head.token, index, text: text.slice(index * SIZE, (index + 1) * SIZE) }));
    result = await call({ action: 'wire-commit', token: head.token });
  }
  if (!result.transfer) return result;
  const head = result.transfer;
  if (!Number.isInteger(head.count) || head.count < 1 || head.count > 2100) throw new Error('invalid-transfer');
  const chunks = new Array(head.count);
  await parts(head.count, async index => {
    const part = await call({ action: 'wire-get', token: head.token, index });
    if (typeof part.text !== 'string' || part.text.length > SIZE) throw new Error('invalid-transfer-part');
    chunks[index] = part.text;
  });
  const joined = chunks.join('');
  if (joined.length !== head.length || checksum(joined) !== head.checksum) throw new Error('transfer-checksum-mismatch');
  result = JSON.parse(joined);
  if (!result || !result.ok) throw new Error('invalid-transfer-result');
  return result;
}
module.exports = { send, checksum };
