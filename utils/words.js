const tuples = require('../data/vocabulary');
const enrichment = require('../data/enrichment');
const learningContent = require('../data/learning-content');

let cache;
let mapCache;

function inflate(tuple, position) {
  const category = tuple[0] === 'c' ? 'core' : 'high';
  const id = `${tuple[0]}-${tuple[1]}-${tuple[2]}`;
  const extra = enrichment[id] || {};
  return Object.assign({
    id,
    category,
    day: tuple[1],
    index: tuple[2],
    word: tuple[3],
    meaning: tuple[4],
    position,
    sourceLabel: `${category === 'core' ? '核心' : '高频'} day ${tuple[1]} · #${tuple[2]}`,
    searchText: `${tuple[3]} ${tuple[4]}`.toLowerCase(),
    enhanced: Boolean(enrichment[id]),
  }, learningContent[id] || {}, extra);
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
