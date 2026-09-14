const { DAY_MS, dayKey, startOfDay } = require('./date');
const context = require('./context');
const { isStable } = require('./scheduler');
const { getWord, getWords } = require('./words');
const weakBook = require('./weak-book');

const REVIEW_PLAN_VERSION = 2;
const DEFAULT_DAILY_REVIEW_LIMIT = 80;
const DEFAULT_DAILY_BACKLOG_LIMIT = 30;

function reviewPriority(state, left, right) {
  const leftCard = state.cards[left.id] || {};
  const rightCard = state.cards[right.id] || {};
  const leftUrgent = leftCard.needsRecall || leftCard.needsContext ? 1 : 0;
  const rightUrgent = rightCard.needsRecall || rightCard.needsContext ? 1 : 0;
  if (leftUrgent !== rightUrgent) return rightUrgent - leftUrgent;
  return (leftCard.dueAt || 0) - (rightCard.dueAt || 0)
    || left.position - right.position;
}

function selectReviews(state, settings, words, time, progress) {
  const todayStart = startOfDay(time);
  const daily = progress || state.daily[dayKey(time)] || {};
  const totalLimit = settings.dailyReviewLimit || DEFAULT_DAILY_REVIEW_LIMIT;
  const backlogLimit = settings.dailyBacklogLimit || DEFAULT_DAILY_BACKLOG_LIMIT;
  const totalCapacity = Math.max(0, totalLimit - (daily.dueDone || 0));
  const backlogCapacity = Math.max(0, Math.min(
    totalCapacity,
    backlogLimit - (daily.backlogDone || 0),
  ));
  const overdue = [];
  const current = [];

  words.forEach((word) => {
    const card = state.cards[word.id] || {};
    (card.dueAt < todayStart ? overdue : current).push(word);
  });
  overdue.sort((left, right) => reviewPriority(state, left, right));
  current.sort((left, right) => reviewPriority(state, left, right));

  const selectedOverdue = overdue.slice(0, backlogCapacity);
  const selectedCurrent = current.slice(0, Math.max(0, totalCapacity - selectedOverdue.length));
  const selected = selectedOverdue.concat(selectedCurrent);
  return {
    words: selected,
    overdueIds: new Set(selectedOverdue.map((word) => word.id)),
    backlogCount: selectedOverdue.length,
    deferredCount: Math.max(0, words.length - selected.length),
  };
}

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
  const reviewPlan = selectReviews(state, settings, due, time, today);
  const newCount = today.newGoal == null
    ? Math.min(settings.dailyNewCount, unseen.length)
    : Math.max(0, today.newGoal - (today.newDone || 0));
  const estimatedMinutes = Math.max(
    5,
    Math.ceil((reviewPlan.words.length * 12 + newCount * 22) / 60),
  );

  return {
    due,
    estimatedMinutes,
    learned,
    newCount,
    overdue,
    scheduledBacklogCount: reviewPlan.backlogCount,
    scheduledDue: reviewPlan.words,
    deferredDueCount: reviewPlan.deferredCount,
    stable,
    unseen,
    weak,
  };
}

function appendContextItems(queue, time) {
  const contextItems = [];
  const seenQuestions = {};
  const rotation = Math.floor(startOfDay(time) / DAY_MS);
  queue.forEach((item) => {
    const word = getWord(item.wordId);
    const question = word && context.getByWord(word.word, rotation);
    if (question && !seenQuestions[question.id]) {
      seenQuestions[question.id] = true;
      contextItems.push({ wordId: word.id, phase: 'context', questionId: question.id, reinforced: true });
    }
  });
  queue.push(...contextItems);
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleReviews(words, today) {
  const shuffled = words.slice();
  let seed = stableHash(`${today}:${shuffled.map((word) => word.id).join('|')}`);
  const random = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function prepareSession(session, state, settings, now) {
  const time = now || Date.now();
  if (!session || !Array.isArray(session.queue) || session.mode === 'practice' || session.day !== dayKey(time)
    || session.reviewPlanVersion === REVIEW_PLAN_VERSION) return false;

  const completed = session.queue.slice(0, session.index);
  const remaining = session.queue.slice(session.index);
  const reviewItems = remaining.filter((item) => item.phase === 'review');
  const candidates = reviewItems.map((item) => getWord(item.wordId)).filter(Boolean);
  const reviewPlan = selectReviews(state, settings, candidates, time, {
    dueDone: session.dueDone || 0,
    backlogDone: session.backlogDone || 0,
  });
  const selectedItems = shuffleReviews(reviewPlan.words, session.day).map((word) => ({
    wordId: word.id,
    phase: 'review',
    reinforced: false,
    overdue: reviewPlan.overdueIds.has(word.id),
  }));
  const selectedIds = new Set(selectedItems.map((item) => item.wordId));
  const droppedIds = new Set(reviewItems
    .map((item) => item.wordId)
    .filter((wordId) => !selectedIds.has(wordId)));
  let selectedIndex = 0;
  const nextRemaining = [];

  remaining.forEach((item) => {
    if (item.phase === 'review') {
      if (selectedIndex < selectedItems.length) nextRemaining.push(selectedItems[selectedIndex++]);
      return;
    }
    if (item.phase === 'context' && droppedIds.has(item.wordId)) return;
    nextRemaining.push(item);
  });

  session.queue = completed.concat(nextRemaining);
  session.dueGoal = (session.dueDone || 0) + selectedItems.length;
  session.backlogDone = session.backlogDone || 0;
  session.reviewPlanVersion = REVIEW_PLAN_VERSION;
  return true;
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
    backlogDone: previous.backlogDone || 0,
    newDone: previous.newDone || 0,
    reinforcementDone: previous.reinforcementDone || 0,
    contextDone: previous.contextDone || 0,
    contextCorrect: previous.contextCorrect || 0,
    ratings: Object.assign({ again: 0, hard: 0, good: 0, easy: 0 }, previous.ratings || {}),
    elapsedSeconds: Math.max(0, (previous.minutes || 0) * 60),
    reviewPlanVersion: REVIEW_PLAN_VERSION,
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

  // Review order changes each day so source-list neighbours cannot become a
  // hidden recall cue. New words keep the institution's original order.
  const overdueIds = new Set(stats.overdue.map((word) => word.id));
  shuffleReviews(stats.scheduledDue, today)
    .forEach((word) => queue.push({
      wordId: word.id,
      phase: 'review',
      reinforced: false,
      overdue: overdueIds.has(word.id),
    }));
  newWords.forEach((word) => queue.push({ wordId: word.id, phase: 'new', reinforced: false }));

  appendContextItems(queue, time);
  return makeSession(today, time, queue, daily, {
    dueGoal: (daily.dueDone || 0) + stats.scheduledDue.length,
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
  appendContextItems(queue, time);
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

module.exports = { buildExtraSession, buildSession, prepareSession, progressStats, summarize };
