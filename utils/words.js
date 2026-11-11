const tuples = require('../data/vocabulary');
const enrichment = require('../data/enrichment');
const learningContent = require('../data/learning-content');
const readingContent = require('../data/reading-content');
const reviewedPronunciations = require('../data/reviewed-pronunciations');

const identity = require('./word-identity');
let sourceCache;
let cache;
let mapCache;

function normalizeLegacyIpa(ipa) {
  // ECDICT's older transcription uses ASCII stress and length, Cyrillic
  // lookalikes, and i/u for short vowels. Keep already modern notation intact.
  if (!ipa || (/[ˈˌː]/.test(ipa) && !/[':әє]/.test(ipa))) return ipa;
  return ipa
    .replace(/ә/g, 'ə').replace(/є/g, 'e').replace(/g/g, 'ɡ')
    .replace(/'/g, 'ˈ').replace(/[.,]/g, 'ˌ').replace(/:/g, 'ː')
    .replace(/əː/g, 'ɜː').replace(/ɒː/g, 'ɔː')
    .replace(/ɒi|ɔi/g, 'ɔɪ').replace(/([ae])i/g, '$1ɪ')
    .replace(/([aoə])u/g, '$1ʊ')
    .replace(/i(?=[bdfhjklmnprstvwzɡŋʃʒθð])/g, 'ɪ')
    .replace(/u(?=[bdfhjklmnprstvwzɡŋʃʒθð])/g, 'ʊ');
}

function inflate(tuple, position) {
  const category = tuple[0] === 'c' ? 'core' : 'high';
  const id = `${tuple[0]}-${tuple[1]}-${tuple[2]}`;
  const extra = enrichment[id] || {};
  const word = Object.assign({
    id,
    category,
    day: tuple[1],
    index: tuple[2],
    word: tuple[3],
    meaning: tuple[4],
    position,
    sourceLabel: `${category === 'core' ? '核心' : '高频'} day ${tuple[1]} · #${tuple[2]}`,
    searchText: `${tuple[3]} ${tuple[4]}`.toLowerCase(),
    enhanced: true, family: '', phrase: '', contrast: '', cue: '', wordForms: [],
  }, learningContent[id] || {}, extra, enrichment[id] ? { cueLabel: '这样关联' } : {});
  word.ipa = reviewedPronunciations[id] || reviewedPronunciations[word.spokenWord] || normalizeLegacyIpa(word.ipa);
  const reading = readingContent.sentences[readingContent.words[id]];
  word.example = reading[0];
  word.translation = reading[1];
  word.exampleCredit = 'LexiLoop 编写';
  word.phrase = readingContent.phrases[id] || '';
  word.exampleSense = readingContent.senses[id] || '';
  const generated = learningContent[id] || {};
  // A reviewed guide is newer than the legacy enrichment hints. Re-apply only
  // its learning fields so older hand-corrected IPA/example data stays intact.
  if (generated.reviewedGuide) {
    ['core', 'cue', 'breakdown', 'breakdownNote', 'associationLabel', 'contrast', 'partOfSpeech']
      .forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(generated, key)) word[key] = generated[key];
      });
    word.cueLabel = '这样关联';
  }
  // Preserve reviewed guidance first. The generated fallback must never replace
  // it with a phrase chunk or a repeated definition.
  const generatedHint = generated.associationHint || '';
  const usefulGeneratedHint = /^(语义归组|词义锚点)：/.test(generatedHint) ? '' : generatedHint;
  word.memoryHint = generated.reviewedGuide
    ? (generated.cue || '')
    : (extra.cue || generated.cue || usefulGeneratedHint);
  word.associationLabel = generated.reviewedGuide
    ? (generated.associationLabel || '拆解助记')
    : (extra.cue ? '助记' : (word.associationLabel || '短语钩子'));
  word.shortHint = word.memoryHint.length <= 60 ? word.memoryHint : '';
  word.associationHint = word.memoryHint;
  word.cue = word.associationHint || word.contrast || word.family || word.breakdown || word.meaning;
  word.hasMemoryContent = Boolean(word.breakdown || word.associationHint || word.contrast || word.phrase
    || word.family || (word.wordForms && word.wordForms.length));
  word.exampleSourceDetail = word.exampleCredit === 'LexiLoop 编写'
    ? '本应用原创的英语（二）阅读风格练习例句，不是历年真题原文或机构例句。'
    : '例句选自 Tatoeba。许可：CC BY 2.0 France。中文已转为简体。\n' + word.exampleCredit + '\nhttps://creativecommons.org/licenses/by/2.0/fr/';
  word.shortPartOfSpeech = (word.partOfSpeech.match(/\b(?:adj|adv|vt|vi|v|n|pron|prep|conj|interj|num|art|aux|det)\./g) || []).filter((value, i, all) => all.indexOf(value) === i).join(' / ')
    || (/介词/.test(word.partOfSpeech) ? 'prep. phr.' : 'modal phr.');
  if (word.shortPartOfSpeech.includes('vt.') && word.shortPartOfSpeech.includes('vi.')) word.shortPartOfSpeech = word.shortPartOfSpeech.replace('vt.', 'v.').replace(' / vi.', '').replace('vi. / ', '');
  word.shortPartOfSpeech = word.shortPartOfSpeech.replace(/ \/ /g, '/');
  return word;
}

function getSourceWords() {
  if (!sourceCache) sourceCache = tuples.map(inflate);
  return sourceCache;
}
function getWords() {
  if (!cache) {
    const source = getSourceWords();
    const raw = Object.fromEntries(source.map(word => [word.id, word]));
    const merged = {};
    identity.groups.forEach(ids => {
      const records = ids.map(id => raw[id]);
      const meaning = [...new Set(records.flatMap(word => word.meaning.split(/[；;]/)).map(value => value.trim()).filter(Boolean))].join('；');
      merged[ids[0]] = Object.assign({}, records[0], {
        meaning,
        searchText: records.map(word => word.searchText + ' ' + word.word.replace(/\(u\)/g, 'u')).join(' '),
        sources: records.map(({ id, category, day, index, sourceLabel }) => ({ id, category, day, index, sourceLabel })),
      });
    });
    cache = source.filter(word => identity.canonicalId(word.id) === word.id).map(word => merged[word.id] || word);
  }
  return cache;
}

function getWordMap() {
  if (!mapCache) {
    mapCache = {};
    getWords().forEach((word) => { mapCache[word.id] = word; });
    identity.groups.forEach(ids => ids.slice(1).forEach(id => { mapCache[id] = mapCache[ids[0]]; }));
  }
  return mapCache;
}

function getWord(id) {
  return getWordMap()[id] || null;
}

module.exports = { getWord, getWordMap, getWords, getSourceWords };
