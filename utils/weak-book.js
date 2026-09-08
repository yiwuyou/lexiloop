function ensure(state) {
  if (!state.weakBook || typeof state.weakBook !== 'object') state.weakBook = {};
  return state.weakBook;
}

function isMarked(state, wordId) {
  return Boolean(state && ensure(state)[wordId]);
}

function mark(state, wordId, source, now) {
  const book = ensure(state);
  if (!book[wordId]) book[wordId] = { addedAt: now || Date.now(), source: source || 'manual' };
  return book[wordId];
}

function unmark(state, wordId) {
  const book = ensure(state);
  if (!book[wordId]) return false;
  delete book[wordId];
  return true;
}

function toggle(state, wordId, now) {
  if (isMarked(state, wordId)) {
    unmark(state, wordId);
    return false;
  }
  mark(state, wordId, 'manual', now);
  return true;
}

function shouldAutoMark(card, grade) {
  return grade === 'again' || (grade === 'hard' && Number(card && card.hardStreak || 0) >= 2);
}

module.exports = { ensure, isMarked, mark, shouldAutoMark, toggle, unmark };
