const assert = require('assert');
const zlib = require('zlib');
const codec = require('../utils/sync-codec');
const wire = require('../utils/sync-wire');
for (const text of ['', 'a', 'ab', 'abc', '中文😀', 'English 中文\n"'.repeat(5000)].map(value => JSON.stringify({ value }))) {
  const packed = codec.pack(text);
  assert.strictEqual(codec.unpack(packed), text);
  assert.strictEqual(zlib.gunzipSync(Buffer.from(packed.data, 'base64')).toString('utf8'), text);
  assert.strictEqual(codec.unpack({ ...packed, data: zlib.gzipSync(text).toString('base64') }), text);
  assert.throws(() => codec.unpack({ ...packed, checksum: packed.checksum === '0' ? '1' : '0' }), /checksum-mismatch/);
  assert.throws(() => codec.unpack({ ...packed, length: packed.length + 1 }), /length-mismatch/);
}
assert.throws(() => codec.unpack({ encoding: codec.ENCODING, data: 'AAAA', length: codec.MAX + 1, checksum: '0' }), /invalid-packed-data/);
const tiny = codec.pack('A valid bounded record.');
assert.throws(() => codec.unpack({ ...tiny, data: tiny.data + 'not base64' }), /invalid-packed-data/);
assert.throws(() => codec.unpack({ ...tiny, encoding: 'unknown' }), /invalid-packed-data/);
const finalSize = Buffer.from(tiny.data, 'base64'); finalSize.writeUInt32LE(codec.MAX + 1, finalSize.length - 4);
assert.throws(() => codec.unpack({ ...tiny, data: finalSize.toString('base64') }), /length-mismatch/, 'a forged gzip size is rejected before inflation');
async function measured(event, options) {
  let calls = 0;
  await wire.send(async frame => {
    calls++;
    assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 32768);
    return { ok: true, token: 'synthetic-transfer' };
  }, event, options);
  return calls;
}
async function main() {
  const backlog = Array.from({ length: 140 }, (_, index) => ({ device: 'offline-batch-owner', seq: index + 1, epoch: 1, baseRev: 1,
    changes: [{ path: ['state', 'cards', 'word-' + index], before: { note: 'older-card '.repeat(80) }, after: { note: 'reviewed-card '.repeat(80) } }],
  }));
  const selected = wire.batch(backlog);
  assert.strictEqual(selected.length, 60, 'compressible backlog uses the full contiguous batch instead of an 18KB raw prefix');
  assert.deepStrictEqual(selected.map(event => event.seq), Array.from({ length: 60 }, (_, i) => i + 1));
  assert.strictEqual(await measured({ action: 'sync', events: selected }), 1, 'a compressed small batch uses exactly one request without temporary fragments');
  const beforeSelection = JSON.stringify(backlog); wire.batch(backlog);
  assert.strictEqual(JSON.stringify(backlog), beforeSelection, 'selection never mutates the durable or in-flight journal');
  const fixture = { action: 'sync', events: Array.from({ length: 8 }, (_, i) => ({
    seq: i + 1, changes: [{ path: ['state', 'daily', '2026-11-03'], after: {
      firstAnswers: Object.fromEntries(Array.from({ length: 150 }, (_, j) => ['synthetic-' + j, 'review'])),
      time: { segments: Object.fromEntries(Array.from({ length: 300 }, (_, j) => ['segment-' + j, { start: j * 10000, end: j * 10000 + 9000, phase: 'review' }])) },
    } }],
  })) };
  const legacy = await measured(fixture, { compress: false });
  const compressed = await measured(fixture);
  assert.ok(compressed <= legacy / 5, 'growing daily timing records must not amplify into hundreds of database-backed chunks');
  let starts = 0, finished = 0;
  await assert.rejects(wire.send(async frame => {
    if (frame.action === 'wire-begin') return { ok: true, token: 'failing-transfer' };
    if (frame.action === 'wire-put') {
      starts++;
      if (frame.index === 0) throw Error('one chunk failed');
      await new Promise(resolve => setImmediate(resolve)); finished++;
    }
    return { ok: true };
  }, fixture, { compress: false }), /one chunk failed/);
  assert.strictEqual(starts, 4, 'no later group starts after an upload failure');
  assert.strictEqual(finished, 3, 'all already-started siblings settle before retry becomes possible');
  console.log('Bounded gzip/base64, UTF-8, Node interoperability, corruption/size guards and grouped retries passed.', { legacyCalls: legacy, compressedCalls: compressed });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
