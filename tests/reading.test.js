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
  if (w.exampleSense) assert.ok(q.explanation.includes(w.meaning) && q.explanation.includes('补充用法'));
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
  ['stem', 'stem from'], ['toll', 'take a toll on'],
]) assert.ok(wordByHead.get(head).phrase.includes(expected), head);
for (const head of ['toll', 'latitude', 'lobby', 'dwell', 'objective', 'stem']) {
  assert.ok(wordByHead.get(head).exampleSense, head + ': keep supplemental senses distinct');
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
  console.log('2522 original reading examples/phrases, source meanings, supplemental-sense answers and offline immediate phrases passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
