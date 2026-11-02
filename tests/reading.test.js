const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getWords } = require('../utils/words');
const { getRecallQuestion } = require('../utils/context');
const tuples = require('../data/vocabulary');
const bank = require('../data/reading-content');
const retained = require('../data/retained-phrases.json');
const runtime = require('../data/learning-content');
const words = getWords();
const wordByHead = new Map(words.map(w => [w.spokenWord.toLowerCase(), w]));
assert.strictEqual(Object.keys(bank.words).length, 2522);
assert.strictEqual(Object.keys(bank.phrases).length, 2522);
assert.ok(bank.sentences.length > 650, 'do not collapse the bank into generic templates');
assert.strictEqual(new Set(bank.sentences.map(s => s[0])).size, bank.sentences.length);
const sourceRows = fs.readFileSync(path.join(__dirname, '../data/reading-examples.tsv'), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#'));
assert.strictEqual(sourceRows.length, bank.sentences.length);
const useCount = {};
for (const [i, w] of words.entries()) {
  assert.strictEqual(w.id, tuples[i].slice(0, 3).join('-'));
  assert.strictEqual(w.meaning, tuples[i][4]);
  assert.ok(w.example && w.translation && w.phrase);
  assert.strictEqual(w.exampleCredit, 'LexiLoop 编写');
  assert.ok(w.exampleSourceDetail.includes('不是历年真题原文'));
  assert.ok(!Object.prototype.hasOwnProperty.call(runtime[w.id], 'example'), 'superseded runtime examples should not inflate the main package');
  const count = w.example.split(/\s+/).length;
  assert.ok(count >= 10 && count <= 42, w.id + ': avoid fragments and oversized paragraphs');
  if (!useCount[bank.words[w.id]]) useCount[bank.words[w.id]] = new Set();
  useCount[bank.words[w.id]].add(w.spokenWord.toLowerCase());
  const q = getRecallQuestion(w);
  assert.strictEqual(q.sentence, w.example);
  assert.strictEqual(q.translation, w.translation);
  const correct = w.exampleSense ? w.exampleSense.replace(/（[^）]*）/g, '').trim() : w.meaning;
  assert.strictEqual(q.choices[q.answer], correct, w.id + ': answer must fit the sentence sense');
  assert.strictEqual(new Set(q.choices).size, 3);
  if (w.exampleSense) {
    assert.ok(w.meaning.replace(/\s/g, '').includes(w.exampleSense.replace(/\s/g, '')), w.id + ': sentence sense outside institution meaning');
    assert.ok(q.explanation.includes(w.meaning) && !q.explanation.includes('补充用法'));
  }
}
assert.ok(Math.max(...Object.values(useCount).map(heads => heads.size)) <= 4,
  'only a few naturally shared targets may reuse a sentence; source duplicates retain their IDs');
for (const [head, phrase] of Object.entries(retained)) {
  assert.ok(wordByHead.get(head).phrase.startsWith(phrase), head + ': retain earlier reviewed expressions');
}
for (const [head, expected] of [
  ['esteem', 'self-esteem 自尊'], ['devote', 'devote time to'],
  ['subject', 'be subject to'], ['account', 'account for'],
  ['comply', 'comply with'], ['attribute', 'attribute A to B'],
  ['stem', 'stem the spread of'], ['toll', 'pay a toll'],
]) assert.ok(wordByHead.get(head).phrase.includes(expected), head);
const revised = require('../data/institution-reading-review.json').reviewed;
for (const [head, review] of Object.entries(revised)) {
  const word = wordByHead.get(head);
  assert.strictEqual(word.exampleSense, review.sense);
  assert.ok(word.phrase.includes(review.phrase));
}
assert.ok(!/dwell on/.test(wordByHead.get('dwell').example + wordByHead.get('dwell').phrase));
assert.ok(!wordByHead.get('command').example.includes('command of'));
assert.strictEqual(getRecallQuestion(Object.assign({}, wordByHead.get('dwell'), { exampleSense: '反复思考' })), null,
  'stale or unapproved extra meanings must not become a mismatched question');
const normalize = value => value.toLowerCase().replace(/behaviour|behavio\(u\)r/g, 'behavior').replace('while/whilst', 'while').replace(/\s/g, '');
for (const question of require('../data/context-questions')) {
  assert.strictEqual(new Set(question.choices).size, 3, question.id + ': keep three distinct answer choices when correcting an old question');
  const records = words.filter(word => normalize(word.spokenWord) === normalize(question.word));
  assert.ok(records.length && question.institutionSense, question.id);
  assert.strictEqual(question.choices[question.answer], question.institutionSense, question.id);
  for (const word of records) assert.ok(normalize(word.meaning).includes(normalize(question.institutionSense)), question.id + ': outside this source record');
}
assert.ok(wordByHead.get('consume').family.includes('consumer 消费者'));
assert.ok(wordByHead.get('consume').family.includes('consumption 消费；消耗'));
assert.ok(!words.some(word => ['consumer', 'consumption'].includes(word.spokenWord)), 'auxiliary family words must not become new learning cards');
for (const invalid of ['反复思考', '住']) {
  let writes = 0;
  const buildRequire = name => {
    if (name === 'fs') return Object.assign({}, fs, { writeFileSync() { writes++; throw Error('unexpected authoring write'); } });
    if (name === '../data/reading-senses.json') return Object.assign({}, require(name), { dwell: invalid });
    if (name.startsWith('../data/')) return JSON.parse(JSON.stringify(require(name)));
    return require(name);
  };
  assert.throws(() => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/build-reading-content.js'), 'utf8'), {
    require: buildRequire, __dirname: path.join(__dirname, '../scripts'), console,
  }), /sentence sense must come from institution meaning/);
  assert.strictEqual(writes, 0, 'reject out-of-source or partial senses before changing generated data');
}
// A card already contains its reviewed phrases. Do not download a subpackage
// before showing them or silently replace them with an older fallback pack.
const moduleMock = { exports: {} };
let downloads = 0;
const requireMock = () => { throw Error('unexpected synchronous subpackage require'); };
requireMock.async = () => { downloads++; return Promise.reject(Error('offline')); };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/phrases.js'), 'utf8'), {
  module: moduleMock, require: requireMock, Promise,
});
async function main() {
  const esteem = wordByHead.get('esteem');
  assert.strictEqual(await moduleMock.exports.phraseFor(esteem), esteem.phrase);
  assert.strictEqual(downloads, 0);
  await assert.rejects(moduleMock.exports.phraseFor({ id: 'fallback' }), /offline/);
  await assert.rejects(moduleMock.exports.phraseFor({ id: 'fallback' }), /offline/);
  assert.strictEqual(downloads, 2, 'a failed optional fallback must remain retryable');
  console.log('2522 reading records, institution-only answer senses, revised target examples, word families and offline immediate phrases passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
