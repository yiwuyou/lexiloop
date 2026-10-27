// A manifest is published only after every chunk is durable. This keeps sync
// journals below WeChat's per-key limit without touching existing study keys.
const CHUNK = 180000;
function chunks(value) { return value && value.syncChunks === 1 && typeof value.prefix === 'string' && Number.isInteger(value.count); }
function clean(value) {
  if (chunks(value)) for (let i = 0; i < value.count; i++) {
    try { wx.removeStorageSync(`${value.prefix}:${i}`); } catch (error) { /* Later writes remain safe. */ }
  }
}
function read(key) {
  const value = wx.getStorageSync(key);
  if (!chunks(value)) return value;
  let text = '';
  for (let i = 0; i < value.count; i++) {
    const part = wx.getStorageSync(`${value.prefix}:${i}`);
    if (typeof part !== 'string' || !part.length) throw new Error('incomplete-sync-storage');
    text += part;
  }
  return JSON.parse(text);
}
function write(key, value) {
  const previous = wx.getStorageSync(key), text = JSON.stringify(value);
  if (text.length <= CHUNK) { wx.setStorageSync(key, value); clean(previous); return; }
  const manifest = { syncChunks: 1, prefix: `${key}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`, count: Math.ceil(text.length / CHUNK) };
  try {
    for (let i = 0; i < manifest.count; i++) wx.setStorageSync(`${manifest.prefix}:${i}`, text.slice(i * CHUNK, (i + 1) * CHUNK));
    wx.setStorageSync(key, manifest);
  } catch (error) { clean(manifest); throw error; }
  clean(previous);
}
function remove(key) { const previous = wx.getStorageSync(key); wx.removeStorageSync(key); clean(previous); }
module.exports = { read, write, remove };
