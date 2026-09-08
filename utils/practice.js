const { getWords } = require('./words');
const scheduler = require('./scheduler');
const { dayKey } = require('./date');
const weakBook = require('./weak-book');

// Free practice owns its own session and counters. It never calls the scheduler.
function buildSession(state, options = {}, now = Date.now()) {
  let words = getWords().filter((word) => state.cards[word.id] && state.cards[word.id].seen);
  if (options.category) words = words.filter((word) => word.category === options.category);
  if (options.day) words = words.filter((word) => word.day === Number(options.day));
  if (options.scope === 'weak') words = words.filter((word) => weakBook.isMarked(state, word.id));
  if (!options.day) {
    words.sort((a, b) => (state.cards[b.id].lastAt || 0) - (state.cards[a.id].lastAt || 0) || b.position - a.position);
    words = words.slice(0, 50);
  }
  return {
    mode: 'practice', day: dayKey(now), index: 0, elapsedSeconds: 0,
    queue: words.map((word) => ({ wordId: word.id, phase: 'practice' })),
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
    answers: [],
  };
}

function recordAnswer(state, session, grade, now = Date.now()) {
  const item = session.queue[session.index];
  if (!item || !['again', 'hard', 'good', 'easy'].includes(grade)) return false;
  const day = dayKey(now);
  state.practice = state.practice || {};
  const summary = state.practice[day] || { answers: 0, remembered: 0 };
  summary.answers += 1;
  if (grade === 'good' || grade === 'easy') summary.remembered += 1;
  state.practice[day] = summary;
  session.answers.push({ wordId: item.wordId, grade });
  session.ratings[grade] += 1;
  session.index += 1;
  return true;
}

module.exports = { buildSession, recordAnswer };
