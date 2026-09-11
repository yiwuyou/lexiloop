const tuples = require('../data/vocabulary');
const enrichment = require('../data/enrichment');
const learningContent = require('../data/learning-content');

let cache;
let mapCache;

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
    enhanced: true,
  }, learningContent[id] || {}, extra, enrichment[id] ? { cueLabel: '这样关联' } : {});
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
    ? '本应用编写的记忆例句，不是机构原文。'
    : '例句选自 Tatoeba。许可：CC BY 2.0 France。中文已转为简体。\n' + word.exampleCredit + '\nhttps://creativecommons.org/licenses/by/2.0/fr/';
  return word;
}

function getWords() {
  if (!cache) {
    cache = tuples.map(inflate);
  }
  return cache;
}

function getWordMap() {
  if (!mapCache) {
    mapCache = {};
    getWords().forEach((word) => {
      mapCache[word.id] = word;
    });
  }
  return mapCache;
}

function getWord(id) {
  return getWordMap()[id] || null;
}

module.exports = { getWord, getWordMap, getWords };
