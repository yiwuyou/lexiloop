// Publish a new manifest only after its data is durable. Packed values also
// reduce the total local quota occupied by learning records and rollback copies.
const CHUNK = 180000;
const PACK_AT = 32768;
let codec;
const compression = () => codec || (codec = require('./sync-codec'));
const KEYS = [
  'mem_vocab_state_v1', 'mem_vocab_session_v1', 'mem_vocab_practice_session_v1',
  'lexiloop_cloud_observed_a_v1', 'lexiloop_cloud_observed_b_v1',
  'lexiloop_cloud_sync_v1', 'mem_vocab_cloud_apply_v1', 'mem_vocab_answer_apply_v1',
  'lexiloop_before_cloud_apply_v1', 'mem_vocab_before_word_merge_v1',
  'mem_vocab_before_fsrs_v1', 'mem_vocab_before_repair_20261027', 'mem_vocab_state_before_v2',
];
function chunks(value) { return value && value.syncChunks === 1 && typeof value.prefix === 'string' && Number.isInteger(value.count); }
function packed(value) { return value && value.syncPacked === 1 && value.packed; }
function unpack(value) { return compression().unpack(value.packed); }
function pack(text) {
  if (text.length < PACK_AT) return null;
  let value;
  try { value = { syncPacked: 1, packed: compression().pack(text) }; }
  catch (error) { if (error.message === 'sync-payload-too-large') return null; throw error; }
  return JSON.stringify(value).length < text.length ? value : null;
}
function clean(value) {
  if (chunks(value)) for (let i = 0; i < value.count; i++) {
    try { wx.removeStorageSync(value.prefix + ':' + i); } catch (error) { /* Keep the published record readable. */ }
  }
}
function read(key) {
  let value = wx.getStorageSync(key);
  if (chunks(value)) {
    let text = '';
    for (let i = 0; i < value.count; i++) {
      const stored = wx.getStorageSync(value.prefix + ':' + i);
      const part = packed(stored) ? unpack(stored) : stored;
      if (typeof part !== 'string' || !part.length) throw new Error('incomplete-sync-storage');
      text += part;
    }
    value = JSON.parse(text);
  }
  return packed(value) ? JSON.parse(unpack(value)) : value;
}
function isFull(error) {
  return /exceed storage max|storage.{0,30}(?:full|limit)|disk.{0,15}full|存储.{0,10}(?:超限|不足)/i
    .test(String(error && (error.errMsg || error.message) || ''));
}
function compact() {
  let changed = 0;
  // Overwrite each existing chunk in place. This frees quota even when there
  // is no room to create a second copy of a whole record. Partial completion
  // remains readable and can resume after an interruption.
  KEYS.forEach(key => {
    const value = wx.getStorageSync(key);
    const targets = chunks(value)
      ? Array.from({ length: value.count }, (_, index) => value.prefix + ':' + index)
      : [key];
    targets.forEach(target => {
      try {
        const old = target === key ? value : wx.getStorageSync(target);
        if (!old || packed(old)) return;
        const text = target === key ? JSON.stringify(old) : old;
        if (typeof text !== 'string') return;
        const next = pack(text);
        if (next) { wx.setStorageSync(target, next); changed++; }
      } catch (error) { /* The old value is still the durable copy. */ }
    });
  });
  return changed;
}
function commit(key, value, text) {
  const previous = wx.getStorageSync(key);
  if (text.length <= CHUNK) { wx.setStorageSync(key, value); clean(previous); return; }
  const manifest = { syncChunks: 1, prefix: key + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2), count: Math.ceil(text.length / CHUNK) };
  try {
    for (let i = 0; i < manifest.count; i++) wx.setStorageSync(manifest.prefix + ':' + i, text.slice(i * CHUNK, (i + 1) * CHUNK));
    wx.setStorageSync(key, manifest);
  } catch (error) { clean(manifest); throw error; }
  clean(previous);
}
function write(key, value) {
  const original = JSON.stringify(value);
  const compressed = pack(original);
  const stored = compressed || value;
  const text = compressed ? JSON.stringify(compressed) : original;
  try { commit(key, stored, text); }
  catch (error) {
    if (!isFull(error) || !compact()) throw error;
    commit(key, stored, text);
  }
}
function remove(key) { const previous = wx.getStorageSync(key); wx.removeStorageSync(key); clean(previous); }
module.exports = { read, write, remove, compact, isFull };
