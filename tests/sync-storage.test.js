const assert = require('assert/strict');
const clone = value => JSON.parse(JSON.stringify(value));
const values = {};
const limit = 10 * 1024 * 1024;
let failWrite = null, peak = 0;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const used = () => Object.values(values).reduce((sum, value) => sum + bytes(value), 0);
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync(key, value) {
    if (failWrite && failWrite(key)) throw Error('injected-write-failure');
    const size = bytes(value);
    assert.ok(size <= 1024 * 1024, 'per-key quota');
    const next = used() - (values[key] ? bytes(values[key]) : 0) + size;
    if (next > limit) throw Error('APP-SERVICE-SDK:setStorageSync:fail exceed storage max length');
    values[key] = clone(value);
    peak = Math.max(peak, next);
  },
  removeStorageSync: key => { delete values[key]; },
};
let generation = 0;
const old = {
  write(key, value) {
    const text = JSON.stringify(value), size = 180000;
    const previous = wx.getStorageSync(key);
    if (text.length <= size) { wx.setStorageSync(key, value); return; }
    const manifest = { syncChunks: 1, prefix: key + ':legacy:' + ++generation, count: Math.ceil(text.length / size) };
    try {
      for (let i = 0; i < manifest.count; i++) wx.setStorageSync(manifest.prefix + ':' + i, text.slice(i * size, (i + 1) * size));
      wx.setStorageSync(key, manifest);
    } catch (error) {
      for (let i = 0; i < manifest.count; i++) wx.removeStorageSync(manifest.prefix + ':' + i);
      throw error;
    }
    if (previous && previous.syncChunks) for (let i = 0; i < previous.count; i++) wx.removeStorageSync(previous.prefix + ':' + i);
  },
  read(key) {
    const manifest = wx.getStorageSync(key);
    if (!manifest.syncChunks) return manifest;
    return JSON.parse(Array.from({ length: manifest.count }, (_, i) => wx.getStorageSync(manifest.prefix + ':' + i)).join(''));
  },
};
const storage = require('../utils/sync-storage');
const seedCard = require('../utils/scheduler').review(null, 'good', Date.parse('2026-11-11T12:00:00+08:00'));
const words = require('../utils/words').getWords();
const state = {
  schemaVersion: 3, cards: {}, daily: {}, weakBook: {},
  recentReviews: Array.from({ length: 3000 }, (_, i) => ({
    id: 'answer-' + i, wordId: words[i % 1500].id, at: 1000000 + i, day: '2026-11-11',
    phase: i % 3 ? 'reinforcement' : 'review', result: i % 4 ? 'good' : 'hard',
  })),
};
words.slice(0, 1500).forEach(word => { state.cards[word.id] = clone(seedCard); });
const meta = { enabled: true, seq: 18, observed: { state, session: { queue: [], index: 0 } },
  outbox: Array.from({ length: 18 }, (_, i) => ({ seq: i + 1, changes: [{ path: ['state', 'recentReviews'], append: [state.recentReviews[i]] }] })) };
const records = {
  mem_vocab_state_v1: state,
  lexiloop_cloud_sync_v1: meta,
  mem_vocab_before_fsrs_v1: { state },
  mem_vocab_before_word_merge_v1: { state },
  mem_vocab_before_repair_20261027: { state },
  lexiloop_before_cloud_apply_v1: { bundle: { state } },
};
Object.entries(records).forEach(([key, value]) => old.write(key, value));
let fill = 0;
while (used() < limit - 65536) {
  const size = Math.min(180000, limit - 65536 - used());
  wx.setStorageSync('unrelated-' + fill++, 'x'.repeat(Math.max(0, size - 2)));
}
const before = used();
assert.throws(() => old.write('mem_vocab_state_v1', Object.assign({}, state, { changed: true })), /exceed storage max length/,
  'the previous writer cannot copy a growing state near total quota');
assert.deepEqual(old.read('mem_vocab_state_v1'), state);
let attempts = 0;
failWrite = key => key.startsWith('mem_vocab_state_v1:') && ++attempts === 2;
assert.ok(storage.compact() > 0);
assert.deepEqual(storage.read('mem_vocab_state_v1'), state, 'mixed packed and legacy chunks survive interruption');
failWrite = null;
storage.compact();
Object.entries(records).forEach(([key, value]) => assert.deepEqual(storage.read(key), value, 'lossless ' + key));
assert.ok(used() < before * .5, 'recover space by encoding, with every record and pending event retained');
const after = Object.assign({}, state, { changed: true });
storage.write('mem_vocab_state_v1', after);
assert.deepEqual(storage.read('mem_vocab_state_v1'), after);
assert.deepEqual(storage.read('lexiloop_cloud_sync_v1').outbox, meta.outbox);
assert.ok(peak <= limit);
console.log('Storage quota replay', { beforeBytes: before, afterBytes: used(), peakBytes: peak });

let randomSeed = 719;
const randomText = Array.from({ length: 600000 }, () => {
  randomSeed ^= randomSeed << 13; randomSeed ^= randomSeed >>> 17; randomSeed ^= randomSeed << 5;
  return String.fromCharCode(33 + ((randomSeed >>> 0) % 90));
}).join('');
storage.write('test-journal', { text: randomText });
const saved = storage.read('test-journal');
let chunkWrites = 0;
failWrite = key => key.startsWith('test-journal:') && ++chunkWrites === 2;
assert.throws(() => storage.write('test-journal', { text: randomText + randomText }), /injected/);
failWrite = null;
assert.deepEqual(storage.read('test-journal'), saved, 'failure preserves the previously published value');
storage.remove('test-journal');
assert.ok(!Object.keys(values).some(key => key.startsWith('test-journal')));
const compressed = values.mem_vocab_state_v1;
assert.equal(compressed.syncPacked, 1);
values.mem_vocab_state_v1 = clone(compressed);
values.mem_vocab_state_v1.packed.checksum = '0';
assert.throws(() => storage.read('mem_vocab_state_v1'), /checksum/);
values.mem_vocab_state_v1 = compressed;
console.log('Local storage: 10MB total quota, in-place lossless recovery, pending events, interrupted writes and corruption guards passed.');
