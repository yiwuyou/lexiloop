function key(sentence) { return String(sentence || '').trim(); }

function has(state, sentence) {
  return Boolean(state.sentenceBook && state.sentenceBook[key(sentence)]);
}

function toggle(state, entry, now) {
  const id = key(entry.sentence);
  if (!id || !entry.translation) return false;
  if (!state.sentenceBook) state.sentenceBook = {};
  if (has(state, id)) { delete state.sentenceBook[id]; return false; }
  state.sentenceBook[id] = {
    sentence: id, translation: entry.translation, word: entry.word || '',
    wordId: entry.wordId || '', addedAt: now || Date.now(),
  };
  return true;
}

function list(state) {
  return Object.values(state.sentenceBook || {}).sort((left, right) => right.addedAt - left.addedAt);
}

module.exports = { has, toggle, list };
