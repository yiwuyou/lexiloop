const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getWords, getWord } = require('../utils/words');
const source = require('../data/vocabulary');
const memoryGuides = Object.assign({}, require('../data/memory-guides.json'),
  require('../data/reviewed-memory-guides.json'));
const reviewedPhrases = require('../data/reviewed-phrases.json');
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
assert.ok(compel.breakdown === 'com·pel');
assert.ok(compel.cue.includes('pel'));
assert.ok(getWord('c-2-29').translation.includes('我们'));
assert.ok(!getWord('c-2-29').translation.includes('我們'));
assert.ok(getWord('c-2-29').partOfSpeech.includes('形容词'));
assert.ok(getWord('c-3-19').associationHint.includes('vote（投票）'));
assert.ok(getWord('c-3-20').breakdown.includes('dia'));
assert.ok(getWord('c-3-20').associationHint.includes('全面看透'));
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
const deliberate = getWord('c-3-9');
const dilemma = getWord('c-3-22');
assert.strictEqual(device.breakdown, 'device', 'device must stay whole rather than dev + ice');
assert.ok(device.associationHint.includes('devise'));
assert.strictEqual(dictate.breakdown, 'dict·ate');
assert.ok(desperate.breakdown.includes('sper'));
assert.ok(desperate.breakdownNote.includes('得死拼了'));
assert.strictEqual(deteriorate.breakdown, 'de·teri·or·ate');
assert.strictEqual(deteriorate.associationLabel, '声音钩子');
assert.ok(deteriorate.breakdownNote.includes('地铁里又热'));
assert.strictEqual(drawback.breakdown, 'draw·back');
assert.ok(drawback.breakdownNote.includes('往后拉'));
assert.strictEqual(dilemma.breakdown, 'di·lemma');
assert.ok(dilemma.breakdownNote.includes('双 m'));
assert.ok(dilemma.associationHint.includes('两个 m'));
assert.strictEqual(deliberate.breakdown, 'de·liber·ate');
assert.ok(deliberate.breakdownNote.includes('Libra（天秤座）'));
assert.ok(deliberate.associationHint.includes('Libra（天秤座）'));
const coreDay4 = words.filter((word) => word.id.startsWith('c-4-'));
assert.strictEqual(coreDay4.length, 50);
assert.ok(coreDay4.every((word) => word.breakdown && word.breakdownNote),
  'every core day 4 word must have a form-linked breakdown');
assert.ok(coreDay4.every((word) => !/短语|画面钩子/.test(word.associationLabel)
  && !/^(?:“.*”整块记|把这幕定格)/.test(word.associationHint)),
  'core day 4 must not fall back to phrase/example/scene memorisation');
const coreDay1 = words.filter((word) => word.id.startsWith('c-1-'));
assert.strictEqual(coreDay1.length, 50);
assert.ok(coreDay1.every((word) => word.reviewedGuide && word.breakdown && word.breakdownNote),
  'every core day 1 word must use a reviewed form-linked guide');
assert.ok(coreDay1.every((word) => !/短语|画面钩子/.test(word.associationLabel)
  && !/整块记|把这幕定格|记住例句|例句片段/.test(word.associationHint)),
  'core day 1 must not fall back to phrase/example/scene memorisation');
const coreDay2 = words.filter((word) => word.id.startsWith('c-2-'));
assert.strictEqual(coreDay2.length, 50);
assert.ok(coreDay2.every((word) => word.reviewedGuide && word.breakdown && word.breakdownNote),
  'every core day 2 word must use a reviewed form-linked guide');
assert.ok(coreDay2.every((word) => !/短语|画面钩子/.test(word.associationLabel)
  && !/整块记|把这幕定格|记住例句|例句片段/.test(word.associationHint)),
  'core day 2 must not fall back to phrase/example/scene memorisation');
const coreDay3 = words.filter((word) => word.id.startsWith('c-3-'));
assert.strictEqual(coreDay3.length, 50);
assert.ok(coreDay3.every((word) => word.reviewedGuide && word.breakdown && word.breakdownNote),
  'every core day 3 word must use a reviewed form-linked guide');
assert.ok(coreDay3.every((word) => !/短语|画面钩子/.test(word.associationLabel)
  && !/整块记|把这幕定格|记住例句|例句片段/.test(word.associationHint)),
  'core day 3 must not fall back to phrase/example/scene memorisation');
const coreDay5 = words.filter((word) => word.id.startsWith('c-5-'));
assert.strictEqual(coreDay5.length, 50);
assert.ok(coreDay5.every((word) => word.reviewedGuide && word.breakdown && word.breakdownNote),
  'every core day 5 word must use a reviewed form-linked guide');
assert.ok(coreDay5.every((word) => !/短语|画面钩子/.test(word.associationLabel)
  && !/整块记|把这幕定格|记住例句|例句片段/.test(word.associationHint)),
  'core day 5 must not fall back to phrase/example/scene memorisation');
assert.ok(words.find((word) => word.word.toLowerCase() === 'expel').breakdownNote.includes('向外赶'));
assert.ok(words.find((word) => word.word.toLowerCase() === 'explicit').breakdownNote.includes('折'));
assert.ok(words.find((word) => word.word.toLowerCase() === 'expire').breakdownNote.includes('最后一口气'));
assert.ok(words.find((word) => word.word.toLowerCase() === 'facilitate').breakdownNote.includes('使变容易'));
assert.ok(words.find((word) => word.word.toLowerCase() === 'fiscal').breakdownNote.includes('国库'));
assert.ok(words.find((word) => word.word.toLowerCase() === 'estimate').breakdownNote.includes('判断价值'));
const confidential = words.find((word) => word.word.toLowerCase() === 'confidential');
const derive = words.find((word) => word.word.toLowerCase() === 'derive');
const foster = words.find((word) => word.word.toLowerCase() === 'foster');
const unexpected = words.find((word) => word.word.toLowerCase() === 'unexpected');
const migrate = words.find((word) => word.word.toLowerCase() === 'migrate');
const emigrate = words.find((word) => word.word.toLowerCase() === 'emigrate');
assert.strictEqual(confidential.breakdown, 'confid·ential');
assert.ok(confidential.breakdownNote.includes('confide（吐露秘密）'));
assert.strictEqual(derive.breakdown, 'de·riv·e');
assert.ok(derive.breakdownNote.includes('river（河流）'));
assert.ok(foster.breakdownNote.includes('扶持它'));
assert.ok(foster.example.includes('foster curiosity'));
assert.ok(!foster.example.includes('by Foster'));
assert.ok(unexpected.associationHint.includes('expect（预期）'),
  'reviewed guide must override the legacy enrichment cue');
assert.ok(migrate.contrast.includes('emigrate（移居国外）'));
assert.ok(migrate.contrast.includes('immigrate（移入、移民进入）'));
assert.ok(migrate.contrast.includes('exit（出去）') && migrate.contrast.includes('in（进入）'));
assert.ok(emigrate.contrast.includes('migrate（迁移、移居）'));
for (const [head, phrase] of Object.entries(reviewedPhrases)) {
  const word = words.find((item) => item.word.toLowerCase() === head.toLowerCase());
  assert.ok(word, `reviewed phrase has no vocabulary head: ${head}`);
  assert.strictEqual(word.phrase, phrase, `reviewed phrase missing from ${head}`);
}
for (const word of words) {
  const titleHead = word.word.slice(0, 1).toUpperCase() + word.word.slice(1);
  const escapedHead = titleHead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.ok(!new RegExp(`\\b(?:by|named|called|mr|mrs|ms|dr|professor)\\.?\\s+${escapedHead}\\b`).test(word.example),
    `example uses ${word.word} only as a proper name: ${word.example}`);
}
const wordsByLowerHead = new Map(words.map((word) => [word.word.toLowerCase(), word]));
for (const [head, guide] of Object.entries(memoryGuides)) {
  const built = wordsByLowerHead.get(head.toLowerCase());
  if (!built) continue;
  for (const [sourceKey, builtKey] of [['cue', 'associationHint'], ['breakdownNote', 'breakdownNote'], ['contrast', 'contrast']]) {
    const raw = guide[sourceKey] || '';
    const rendered = built[builtKey] || '';
    const references = raw.match(/\b[A-Za-z][A-Za-z'-]*\b/g) || [];
    for (const reference of references) {
      if (reference.toLowerCase() === head.toLowerCase() || !wordsByLowerHead.has(reference.toLowerCase())) continue;
      const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.ok(new RegExp(`${escaped}(?:（|\\s*是[“"])`, 'i').test(rendered),
        `${head} references ${reference} without a Chinese gloss in ${builtKey}`);
    }
  }
}
for (const page of ['study', 'library']) {
  const markup = fs.readFileSync(path.join(root, 'pages', page, 'index.wxml'), 'utf8');
  assert.ok(markup.includes('partOfSpeech'));
  assert.strictEqual(markup.includes('bindtap="showExampleSource"'), page === 'library');
  assert.ok(!markup.includes('exampleCredit'), 'raw attribution should be in disclosure, not inline');
}
assert.ok(fs.readFileSync(path.join(root, 'pages/study/index.wxml'), 'utf8').includes('wx:if="{{word.family}}"'));
assert.ok(fs.readFileSync(path.join(root, 'pages/study/index.wxml'), 'utf8').includes('wx:if="{{word.phrase}}"'));
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
