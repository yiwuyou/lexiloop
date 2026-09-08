const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getWords, getWord } = require('../utils/words');
const source = require('../data/vocabulary');
const sizes = require('../data/audio-sizes');
const root = path.join(__dirname, '..');
const words = getWords();
assert.strictEqual(words.length, 2522);
words.forEach((word, index) => {
  const row = source[index];
  assert.strictEqual(word.id, row.slice(0, 3).join('-'));
  assert.strictEqual(word.word, row[3]);
  assert.strictEqual(word.position, index);
  assert.ok(word.enhanced && word.partOfSpeech && word.cue, word.id);
  assert.ok(word.example && word.translation && word.exampleSourceDetail, word.id);
  assert.ok(word.core || word.meaning, 'understanding content missing: ' + word.id);
  assert.ok(word.hasMemoryContent, 'adaptive memory route missing: ' + word.id);
  assert.ok(Array.isArray(word.wordForms));
  if (word.exampleCredit !== 'LexiLoop 编写') {
    assert.ok(word.exampleSourceDetail.includes(word.exampleCredit));
    assert.ok(word.exampleSourceDetail.includes('https://creativecommons.org/licenses/by/2.0/fr/'));
  }
});
assert.ok(words.every((word) => !word.associationHint.includes('记住例句中的用法')));
assert.ok(words.every((word) => !word.associationHint.includes('例句片段')));
assert.ok(words.every((word) => !word.associationHint.startsWith('语义归组：')));
assert.ok(words.every((word) => !word.associationHint.startsWith('词义锚点：')));
assert.ok(words.filter((word) => word.family).every((word) => word.family.length > 0));
assert.strictEqual(words.filter((word) => word.category === 'core' && word.associationHint.startsWith('词义锚点')).length, 0);
const compel = getWord('c-2-17');
assert.strictEqual(compel.word, 'compel');
assert.ok(compel.contrast.includes('compare'));
assert.ok(compel.cue.includes('compel'));
assert.ok(getWord('c-2-29').translation.includes('我们'));
assert.ok(!getWord('c-2-29').translation.includes('我們'));
assert.ok(getWord('c-2-29').partOfSpeech.includes('形容词'));
assert.ok(getWord('c-3-19').associationHint.includes('devote A to B'));
assert.ok(getWord('c-3-20').breakdown.includes('dia'));
assert.ok(getWord('c-3-20').associationHint.includes('diagnose a disease'));
const conscience = words.find((word) => word.word.toLowerCase() === 'conscience');
assert.ok(conscience.breakdown === 'con·sci·ence');
assert.ok(conscience.breakdownNote.includes('知道'));
const detain = words.find((word) => word.word.toLowerCase() === 'detain');
const custody = words.find((word) => word.word.toLowerCase() === 'custody');
assert.ok(detain.contrast.includes('custody'));
assert.ok(custody.contrast.includes('detain'));
const device = words.find((word) => word.word.toLowerCase() === 'device');
const dictate = words.find((word) => word.word.toLowerCase() === 'dictate');
const desperate = getWord('c-3-15');
const deteriorate = getWord('c-3-17');
const drawback = getWord('c-3-24');
assert.strictEqual(device.breakdown, '', 'device must not be mechanically split into dev + ice');
assert.ok(device.associationHint.includes('devise'));
assert.strictEqual(dictate.breakdown, 'dict·ate');
assert.ok(desperate.breakdown.includes('sper'));
assert.ok(desperate.breakdownNote.includes('希望'));
assert.strictEqual(deteriorate.breakdown, '');
assert.strictEqual(deteriorate.associationLabel, '声音画面');
assert.ok(deteriorate.associationHint.includes('地铁里又热'));
assert.strictEqual(drawback.breakdown, 'draw·back');
assert.ok(drawback.breakdownNote.includes('往后拉'));
for (const page of ['study', 'library']) {
  const markup = fs.readFileSync(path.join(root, 'pages', page, 'index.wxml'), 'utf8');
  assert.ok(markup.includes('partOfSpeech'));
  assert.strictEqual(markup.includes('bindtap="showExampleSource"'), page === 'library');
  assert.ok(!markup.includes('exampleCredit'), 'raw attribution should be in disclosure, not inline');
}
assert.ok(fs.readFileSync(path.join(root, 'pages/study/index.wxml'), 'utf8').includes('wx:if="{{word.family}}"'));
assert.ok(fs.readFileSync(path.join(root, 'pages/study/index.wxml'), 'utf8').includes('关联记忆'));
assert.ok(fs.readFileSync(path.join(root, 'pages/today/index.wxml'), 'utf8').includes('{{appVersion}}'));
const moduleMock = { exports: {} };
const loadedPaths = [];
function requireMock() { throw new Error('synchronous cross-package loading is not allowed'); }
requireMock.async = (file) => { loadedPaths.push(file); return Promise.resolve(); };
vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/audio-packages.js'), 'utf8'), {
  module: moduleMock, require: requireMock,
});
async function main() {
  for (const [name, load] of Object.entries(moduleMock.exports)) {
    await load();
    assert.ok(fs.existsSync(path.join(root, name, 'ready.js')));
    const bytes = fs.readdirSync(path.join(root, name)).filter((file) => file.endsWith('.mp3'))
      .reduce((sum, file) => sum + fs.statSync(path.join(root, name, file)).size, 0);
    assert.strictEqual(sizes[name], bytes, 'displayed audio size must use actual files');
  }
  assert.strictEqual(loadedPaths.length, 12);
  assert.strictEqual(new Set(loadedPaths).size, 12);
  const audio = require('../utils/audio');
  assert.strictEqual(audio.totalBytes, 8867160);
  assert.strictEqual(audio.sizeLabel, '8.9 MB');
  await assert.rejects(audio.loadPackage('unknown'), /未知语音分包/);
  assert.strictEqual(audio.describeError({ errMsg: 'network request failed' }), 'network request failed');
  console.log('Full aid/POS coverage, stable IDs/order, source disclosure, async package loaders and audio size passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
