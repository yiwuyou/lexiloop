const pending = {};
const ready = {};
const packages = Array.from({ length: 12 }, (_, index) => `speech${String(index + 1).padStart(2, '0')}`);

function loadPackage(name) {
  if (ready[name]) return Promise.resolve();
  if (pending[name]) return pending[name];
  pending[name] = new Promise((resolve, reject) => {
    wx.loadSubpackage({ name, success: () => { ready[name] = true; resolve(); }, fail: reject });
  }).then(() => { delete pending[name]; }, (error) => { delete pending[name]; throw error; });
  return pending[name];
}

async function sourceFor(word) {
  if (!word || !word.audio) throw new Error('missing-audio');
  if (word.audioPackage) await loadPackage(word.audioPackage);
  return word.audio;
}

async function downloadAll(onProgress) {
  for (let index = 0; index < packages.length; index += 1) {
    await loadPackage(packages[index]);
    onProgress(index + 1, packages.length);
  }
}

module.exports = { sourceFor, downloadAll, loadPackage };
