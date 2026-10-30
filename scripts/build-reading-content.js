// Build the reviewed, original reading bank without rebuilding mnemonics/audio.
// Authoring sources are excluded from the mini-program package.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const vocabulary = require('../data/vocabulary');
const learning = require('../data/learning-content');
const enrichment = require('../data/enrichment');
const reviewed = require('../data/retained-phrases.json');
const sensesByHead = require('../data/reading-senses.json');
const tuplesByHead = new Map();
for (const row of vocabulary) {
  const id = row.slice(0, 3).join('-');
  const head = learning[id].spokenWord.toLowerCase();
  if (!tuplesByHead.has(head)) tuplesByHead.set(head, []);
  tuplesByHead.get(head).push({ id, row, content: learning[id] });
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hasTarget(en, head, content) {
  const forms = new Set([head, ...(content.wordForms || []).map(form => form.word.toLowerCase())]);
  // The legacy forms list omits many ordinary noun plurals. Accept productive
  // spellings as well; no substring, surname or acronym matching is used.
  if (!head.includes(' ')) {
    for (const suffix of ['s', 'es', 'ed', 'd', 'ing']) forms.add(head + suffix);
    if (/[^aeiou]y$/.test(head)) {
      forms.add(head.slice(0, -1) + 'ies');
      forms.add(head.slice(0, -1) + 'ied');
    }
    if (/e$/.test(head)) forms.add(head.slice(0, -1) + 'ing');
  }
  const irregular = { child: 'children', person: 'people', man: 'men', woman: 'women', foot: 'feet', tooth: 'teeth', mouse: 'mice', goose: 'geese', ox: 'oxen' };
  if (irregular[head]) forms.add(irregular[head]);
  return [...forms].some(form => {
    const pattern = new RegExp('(?<![A-Za-z])' + escape(form) + '(?![A-Za-z])', 'gi');
    let match;
    while ((match = pattern.exec(en))) {
      const token = match[0];
      if (/[A-Z]/.test(token) && token === token.toUpperCase()) continue;
      const before = en.slice(0, match.index).trimEnd();
      if (/^[A-Z]/.test(token) && /\b(?:by|named|called|mr|mrs|ms|dr|professor)\.?\s*$/i.test(before)) continue;
      return true;
    }
    return false;
  });
}
function mergePhrases(previous, current) {
  // Retain earlier reviewed expressions (notably self-esteem); avoid duplicates.
  const parts = (previous ? previous.split(/；(?=[A-Za-z])/) : []).filter(Boolean);
  for (const item of current.split(/；(?=[A-Za-z])/)) {
    const english = item.split(/[\u4e00-\u9fff]/)[0].trim().toLowerCase();
    if (!parts.some(part => part.split(/[\u4e00-\u9fff]/)[0].trim().toLowerCase() === english)) parts.push(item);
  }
  return parts.join('；');
}
const sentences = [];
const words = {};
const phrases = {};
const senses = {};
const seen = new Set();
const source = fs.readFileSync(path.join(root, 'data/reading-examples.tsv'), 'utf8');
for (const [i, line] of source.split(/\r?\n/).entries()) {
  if (!line || line.startsWith('#')) continue;
  const fields = line.split('\t');
  assert.strictEqual(fields.length, 3, `line ${i + 1}: expected targets, English, Chinese`);
  const [targets, english, chinese] = fields;
  const count = english.split(/\s+/).length;
  assert.ok(count >= 10 && count <= 42, `line ${i + 1}: ${count} words`);
  assert.ok(/^[A-Z]/.test(english) && /[.!?]$/.test(english), `line ${i + 1}: punctuation`);
  assert.ok(/[\u4e00-\u9fff]/.test(chinese), `line ${i + 1}: Chinese translation`);
  const sentenceIndex = sentences.length;
  sentences.push([english, chinese]);
  const group = targets.split('|');
  assert.ok(group.length <= 4, `line ${i + 1}: too many targets`);
  for (const item of group) {
    const [rawHead, phrase, ...rest] = item.split('^');
    const head = rawHead.toLowerCase();
    assert.ok(!rest.length && phrase && /[\u4e00-\u9fff]/.test(phrase), `line ${i + 1}: phrase ${head}`);
    assert.ok(!seen.has(head), `line ${i + 1}: duplicate ${head}`);
    assert.ok(tuplesByHead.has(head), `line ${i + 1}: unknown ${head}`);
    seen.add(head);
    const merged = mergePhrases(reviewed[head] || '', phrase);
    reviewed[head] = merged;
    for (const { id, content } of tuplesByHead.get(head)) {
      assert.ok(hasTarget(english, head, content), `line ${i + 1}: ${head} not a real word/form in sentence`);
      words[id] = sentenceIndex;
      phrases[id] = merged;
      if (sensesByHead[head]) senses[id] = sensesByHead[head];
    }
  }
}
assert.strictEqual(seen.size, tuplesByHead.size, 'reading examples must cover every spoken head');
for (const head of Object.keys(sensesByHead)) assert.ok(seen.has(head), 'unknown supplemental sense head: ' + head);
assert.strictEqual(Object.keys(words).length, vocabulary.length, 'reading examples must cover every source record');
assert.ok(reviewed.esteem.includes('self-esteem 自尊'));
const writeModule = (file, data, comment) => fs.writeFileSync(path.join(root, file), (comment ? '// ' + comment + '\n' : '') + 'module.exports=' + JSON.stringify(data) + ';\n');
// Clear superseded examples from runtime data. The original authoring files and
// Git history retain provenance; no learning state is read or written here.
for (const dataset of [learning, enrichment]) {
  for (const content of Object.values(dataset)) {
    for (const key of ['example', 'translation', 'exampleCredit', 'phrase']) delete content[key];
  }
}
writeModule('data/learning-content.js', learning);
writeModule('data/enrichment.js', enrichment);
writeModule('data/reading-content.js', { sentences, words, phrases, senses }, 'Original English II reading-oriented practice, not past-paper quotations. Generated by scripts/build-reading-content.js.');
writeModule('phrase-data/ready.js', phrases);
fs.writeFileSync(path.join(root, 'data/reviewed-phrases.json'), JSON.stringify(reviewed, null, 2) + '\n');
console.log(JSON.stringify({ sentences: sentences.length, heads: seen.size, records: Object.keys(words).length, phraseRecords: Object.keys(phrases).length }));
