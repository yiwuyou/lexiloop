const { dayKey, startOfDay } = require('./date');
const context = require('./context');
const { isStable } = require('./scheduler');
const { getWord, getWords } = require('./words');
const weakBook = require('./weak-book');

function summarize(state, settings, now) {
  const time = now || Date.now();
  const todayStart = startOfDay(time);
  const words = getWords();
  const cardStates = state.cards || {};
  const due = [];
  const overdue = [];
  const unseen = [];
  let learned = 0;
  let stable = 0;
  let weak = 0;

  words.forEach((word) => {
    const card = cardStates[word.id];
    if (!card || !card.seen) {
      unseen.push(word);
      return;
    }
    learned += 1;
    if (isStable(card)) stable += 1;
    if (weakBook.isMarked(state, word.id)) weak += 1;
    if (card.needsRecall || card.needsContext || (card.dueAt <= time && card.lastAt < todayStart)) {
      due.push(word);
      if (card.dueAt < todayStart) overdue.push(word);
    }
  });

  const today = state.daily[dayKey(time)] || {};
  const newCount = today.newGoal == null
    ? Math.min(settings.dailyNewCount, unseen.length)
    : Math.max(0, today.newGoal - (today.newDone || 0));
  const estimatedMinutes = Math.max(
    5,
    Math.ceil((due.length * 9 + newCount * 22 + Math.min(overdue.length, 20) * 8) / 60),
  );

  return {
    due,
    estimatedMinutes,
    learned,
    newCount,
    overdue,
    stable,
    unseen,
    weak,
  };
}

function appendContextItems(queue) {
  const contextItems = [];
  const seenQuestions = {};
  queue.forEach((item) => {
    const word = getWord(item.wordId);
    const question = word && context.getByWord(word.word);
    if (question && !seenQuestions[question.id]) {
      seenQuestions[question.id] = true;
      contextItems.push({ wordId: word.id, phase: 'context', questionId: question.id, reinforced: true });
    }
  });
  queue.push(...contextItems);
}

function makeSession(today, time, queue, daily, goals) {
  const previous = daily || {};
  return {
    schemaVersion: 2,
    day: today,
    startedAt: time,
    index: 0,
    queue,
    dueGoal: goals.dueGoal,
    newGoal: goals.newGoal,
    batchNewGoal: goals.batchNewGoal,
    extraNew: goals.extraNew || 0,
    dueDone: previous.dueDone || 0,
    newDone: previous.newDone || 0,
    reinforcementDone: previous.reinforcementDone || 0,
    contextDone: previous.contextDone || 0,
    contextCorrect: previous.contextCorrect || 0,
    ratings: Object.assign({ again: 0, hard: 0, good: 0, easy: 0 }, previous.ratings || {}),
    elapsedSeconds: Math.max(0, (previous.minutes || 0) * 60),
  };
}

function buildSession(state, settings, now) {
  const time = now || Date.now();
  const stats = summarize(state, settings, time);
  const today = dayKey(time);
  const daily = state.daily[today] || {};
  const remainingNew = daily.newGoal == null
    ? settings.dailyNewCount
    : Math.max(0, daily.newGoal - (daily.newDone || 0));
  const newWords = stats.unseen.slice(0, remainingNew);
  const queue = [];

  stats.due.forEach((word) => queue.push({ wordId: word.id, phase: 'review', reinforced: false }));
  newWords.forEach((word) => queue.push({ wordId: word.id, phase: 'new', reinforced: false }));

  appendContextItems(queue);
  return makeSession(today, time, queue, daily, {
    dueGoal: (daily.dueDone || 0) + stats.due.length,
    newGoal: (daily.newDone || 0) + newWords.length,
    batchNewGoal: newWords.length,
    extraNew: daily.extraNew || 0,
  });
}

function buildExtraSession(state, settings, requested, now) {
  const time = now || Date.now();
  const today = dayKey(time);
  const daily = state.daily[today] || {};
  const base = settings.dailyNewCount || 50;
  const maximum = settings.dailyMaxNewCount || 100;
  const currentGoal = Math.max(base, daily.newGoal || daily.newDone || 0);
  const amount = Math.max(0, Math.min(Number(requested) || 0, maximum - currentGoal));
  if (!amount) return null;
  const unseen = summarize(state, settings, time).unseen.slice(0, amount);
  if (!unseen.length) return null;
  const queue = unseen.map((word) => ({ wordId: word.id, phase: 'new', reinforced: false }));
  appendContextItems(queue);
  return makeSession(today, time, queue, daily, {
    dueGoal: daily.dueGoal || 0,
    newGoal: currentGoal + unseen.length,
    batchNewGoal: unseen.length,
    extraNew: Math.max(0, currentGoal + unseen.length - base),
  });
}

function progressStats(state) {
  const words = getWords();
  let learned = 0;
  let stable = 0;
  let weak = 0;
  let coreLearned = 0;
  let highLearned = 0;
  let coreTotal = 0;
  let highTotal = 0;

  words.forEach((word) => {
    if (word.category === 'core') coreTotal += 1;
    else highTotal += 1;
    const card = state.cards[word.id];
    if (!card || !card.seen) return;
    learned += 1;
    if (word.category === 'core') coreLearned += 1;
    else highLearned += 1;
    if (isStable(card)) stable += 1;
    if (weakBook.isMarked(state, word.id)) weak += 1;
  });

  return {
    coreLearned,
    coreTotal,
    highLearned,
    highTotal,
    learned,
    learning: Math.max(0, learned - stable),
    stable,
    total: words.length,
    weak,
  };
}

module.exports = { buildExtraSession, buildSession, progressStats, summarize };
