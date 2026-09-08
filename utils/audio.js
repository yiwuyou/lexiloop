const loaders = require('./audio-packages');
const sizes = require('../data/audio-sizes');
const pending = {};
const ready = {};
const packages = Object.keys(loaders);
const totalBytes = Object.values(sizes).reduce((sum, size) => sum + size, 0);
const sizeLabel = `${(totalBytes / 1000000).toFixed(1)} MB`;
let automatic;
let status = '内置语音约 ' + sizeLabel;
function prepare() {
  if (automatic) return automatic;
  status = '正在准备内置语音 · 共 ' + sizeLabel;
  automatic = downloadAll((count, total) => { status = `正在准备内置语音 ${count}/${total} · 共 ${sizeLabel}`; })
    .then(() => { status = '内置语音已准备好 · 可离线使用'; })
    .catch(() => { status = '语音尚未准备完整，联网后会重试，也可到词库继续'; })
    .finally(() => { automatic = null; });
  return automatic;
}

function loadPackage(name) {
  if (ready[name]) return Promise.resolve();
  if (pending[name]) return pending[name];
  if (!loaders[name]) return Promise.reject(new Error('未知语音分包：' + name));
  pending[name] = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('下载超时，请重试')), 25000);
    Promise.resolve().then(loaders[name]).then(() => {
      clearTimeout(timer); ready[name] = true; resolve();
    }, (error) => { clearTimeout(timer); reject(error); });
  }).then(() => { delete pending[name]; }, (error) => { delete pending[name]; throw error; });
  return pending[name];
}

async function sourceFor(word) {
  if (!word || !word.audio) throw new Error('missing-audio');
  if (word.audioPackage) await loadPackage(word.audioPackage);
  return word.audio;
}

async function downloadAll(onProgress) {
  let bytes = 0;
  for (let index = 0; index < packages.length; index += 1) {
    const name = packages[index];
    try { await loadPackage(name); } catch (error) {
      throw new Error(`${name}：${describeError(error)}`);
    }
    bytes += sizes[name];
    if (onProgress) onProgress(index + 1, packages.length, bytes, totalBytes);
  }
}

function describeError(error) {
  const detail = error && (error.errMsg || error.message) || String(error || '未知错误');
  if (/require.*async.*(function|undefined)/i.test(detail)) return '微信版本暂不支持异步加载，请升级微信';
  return detail.slice(0, 240);
}

module.exports = { sourceFor, downloadAll, loadPackage, describeError, sizeLabel, totalBytes, prepare, getStatus: () => status };
