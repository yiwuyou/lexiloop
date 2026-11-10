const { DAY_MS, dayKey, startOfDay } = require('./date');
const context = require('./context');
const { isStable, isRecoveryPending } = require('./scheduler');
const { getWord, getWords } = require('./words');
const weakBook = require('./weak-book');
const carry = require('./task-carry');
const questionOrder = require('./question-order');
const studyOrder = require('./study-order');
const timeLedger = require('./time-ledger');
const metrics = require('./learning-metrics');

const REVIEW_PLAN_VERSION = 2;
const CONTEXT_PLAN_VERSION = 3;
const DEFAULT_DAILY_REVIEW_LIMIT = 100;
const DEFAULT_DAILY_BACKLOG_LIMIT = 30;
const DAILY_CONTEXT_LIMIT = 12;
const DAILY_SENTENCE_LIMIT = 45;
const REPEAT_SENTENCE_RESERVE = 6;

// Separate exam coverage from the memory model: spread first checks across
// 28 days, rather than truncating every long FSRS interval to the last day.
function examCoverageDue(word, card, settings, now) {
  if (!settings.learningDeadline || !card.seen || isRecoveryPending(card)) return false;
  const end = new Date(settings.learningDeadline + 'T00:00:00+08:00').getTime();
  const start = end - 27 * DAY_MS;
  if (now < start || now >= end + DAY_MS || (card.passedDay || '') >= dayKey(start)) return false;
  return now >= start + (word.position % 28) * DAY_MS;
}

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
    // Unverified restored words are a gradual first check, not a missed
    // historical review. Otherwise an unattended restored batch would be
    // throttled to the separate 30-word overdue allowance forever.
    (card.dueAt < todayStart && !isRecoveryPending(card) ? overdue : current).push(word);
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
  let deferredRecoveryCount = 0;

  words.forEach((word) => {
    const card = cardStates[word.id];
    if (!card || !card.seen) {
      unseen.push(word);
      return;
    }
    learned += 1;
    if (isStable(card)) stable += 1;
    if (weakBook.isMarked(state, word.id)) weak += 1;
    if (card.needsRecall || card.needsContext || (card.dueAt <= time && card.lastAt < todayStart) || examCoverageDue(word, card, settings, time)) {
      due.push(word);
      if (card.dueAt < todayStart && !isRecoveryPending(card)) overdue.push(word);
    } else if (isRecoveryPending(card)) {
      deferredRecoveryCount += 1;
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
    deferredRecoveryCount,
    remainingReviewCount: due.length + deferredRecoveryCount,
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

function queueContextCheck(session, word, grade, now, { repeatMiss = false } = {}) {
  if (!session || !Array.isArray(session.queue) || !word || grade === 'easy') return false;
  const queuedWords = new Set(session.queue
    .filter((item) => item.phase === 'context' || item.phase === 'sentence')
    .map((item) => item.wordId));
  if (queuedWords.has(word.id)) return false;
  const time = now || Date.now();
  const needsRecall = grade === 'again' || grade === 'hard';
  const phase = needsRecall ? 'sentence' : 'context';
  const count = new Set(session.queue.filter((item) => item.phase === phase).map((item) => item.wordId)).size;
  const limit = needsRecall ? DAILY_SENTENCE_LIMIT - (repeatMiss ? 0 : REPEAT_SENTENCE_RESERVE) : DAILY_CONTEXT_LIMIT;
  if (count >= limit) return false;
  const question = needsRecall
    ? context.getRecallQuestion(word)
    : context.getByWord(word.word, Math.floor(startOfDay(time) / DAY_MS));
  if (!question) return false;
  const index = session.index || 0;
  let insertAt = Math.min(session.queue.length, index + 9);
  if (repeatMiss && needsRecall) {
    const nextRecall = session.queue.findIndex((item, position) =>
      position > index && item.wordId === word.id && item.phase === 'reinforcement');
    // Put the example before the next free recall, with other words between when possible.
    if (nextRecall > index) insertAt = Math.max(index + 1, Math.min(insertAt, nextRecall - 4));
  }
  session.queue.splice(insertAt, 0, {
    wordId: word.id,
    phase,
    questionId: question.id,
    reinforced: true,
    availableAt: 0,
  });
  return true;
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

// Older clients could retain yesterday's taskPlan after replacing its queue.
function repairSessionPlan(session, state, settings, now) {
  if (!session || session.mode === 'practice' || !Array.isArray(session.queue)
      || session.day !== dayKey(now)) return false;
  const daily = state.daily[session.day] || {};
  const stored = session.taskPlan || {};
  const ids = Object.keys(stored);
  const previousDays = Object.keys(state.daily).filter(day => day < session.day);
  const copied = ids.length && previousDays.some(day => {
    const previous = state.daily[day].taskPlan;
    return previous && ids.every(id => previous[id] === stored[id]);
  });
  const isBase = item => item.phase === 'review' || item.phase === 'new';
  const isRecall = item => isBase(item) || item.phase === 'reinforcement';
  const prefix = session.queue.slice(0, session.index);
  const tail = session.queue.slice(session.index);
  const answered = new Set(Object.keys(daily.firstAnswers || {}));
  prefix.filter(isRecall).forEach(item => answered.add(item.wordId));
  const seenBefore = new Set();
  previousDays.forEach(day => {
    Object.keys(state.daily[day].firstAnswers || {}).forEach(id => seenBefore.add(id));
  });
  (state.recentReviews || []).filter(isRecall).forEach(item => {
    if (item.day === session.day) answered.add(item.wordId);
    else if (item.day && item.day < session.day) seenBefore.add(item.wordId);
  });
  const dayStart = startOfDay(now);
  const oldWord = id => seenBefore.has(id) || Boolean(state.cards[id] && state.cards[id].seen
    && (!state.cards[id].lastAt || state.cards[id].lastAt < dayStart));
  const scheduled = new Set(session.queue.filter(item => (isBase(item) && !item.reinforced)
    || item.phase === 'context' || item.phase === 'sentence').map(item => item.wordId));
  Object.values(daily.carryTasks || {}).forEach(record => {
    if (record.item) scheduled.add(record.item.wordId);
  });
  const currentPlan = metrics.planFor(state, session, session.day);
  const planned = Object.values(currentPlan);
  const overflow = planned.filter(kind => kind === 'new').length > session.newGoal
    || planned.filter(kind => kind === 'review').length > session.dueGoal;
  const oldIds = new Set(copied && overflow ? ids.filter(id => !scheduled.has(id) && !answered.has(id)) : []);
  const mislabeled = new Set(Object.keys(currentPlan).filter(id => currentPlan[id] === 'new' && oldWord(id)));
  const badNew = item => item.phase === 'new' && oldWord(item.wordId);
  if (!oldIds.size && !mislabeled.size && !tail.some(badNew)) return false;

  const keepReview = new Set(session.queue.filter(item => item.phase === 'review').map(item => item.wordId));
  const corrected = Object.assign({}, (daily.taskPlanCorrection || {}).review);
  const excluded = Object.assign({}, (daily.taskPlanCorrection || {}).excluded);
  mislabeled.forEach(id => {
    if (answered.has(id) || keepReview.has(id)) corrected[id] = true;
    else oldIds.add(id);
  });
  tail.filter(badNew).forEach(item => {
    const id = item.wordId;
    if (answered.has(id) || keepReview.has(id) || currentPlan[id] === 'review') corrected[id] = true;
    else oldIds.add(id);
  });
  oldIds.forEach(id => { excluded[id] = true; });
  const remaining = tail.flatMap(item => {
    if (oldIds.has(item.wordId)) return [];
    if (!badNew(item)) return [item];
    const id = item.wordId;
    if (currentPlan[id] !== 'review' || answered.has(id) || keepReview.has(id)) return [];
    keepReview.add(id);
    return [Object.assign({}, item, { phase: 'review' })];
  });
  const freshDone = new Set([...answered].filter(id => currentPlan[id] === 'new' && !oldWord(id)));
  const newGoal = Math.min(session.newGoal || 0, (settings.dailyNewCount || 50) + (session.extraNew || 0));
  const fresh = new Set(freshDone);
  const deferred = new Set();
  const pending = remaining.filter(item => {
    if (item.phase !== 'new') return true;
    if (fresh.has(item.wordId)) return false;
    if (fresh.size >= newGoal) {
      deferred.add(item.wordId);
      excluded[item.wordId] = true;
      return false;
    }
    fresh.add(item.wordId);
    return true;
  });
  session.queue = prefix.concat(pending.filter(item => !deferred.has(item.wordId)));
  if (fresh.size < newGoal) {
    const words = getWords();
    for (let index = 0; index < words.length && fresh.size < newGoal; index += 1) {
      const id = words[index].id;
      if (fresh.has(id) || oldWord(id) || (state.cards[id] && state.cards[id].seen)) continue;
      session.queue.push({ wordId: id, phase: 'new', reinforced: false });
      fresh.add(id);
    }
  }
  session.newGoal = fresh.size;
  daily.newGoal = session.newGoal;
  daily.taskPlanCorrection = { excluded, review: corrected };
  state.daily[session.day] = daily;
  // Rebuild from the actual queue. The correction also masks old entries
  // if another device still has a copy of the damaged day map.
  session.taskPlan = {};
  session.taskPlan = metrics.planFor(state, session, session.day);
  metrics.commit(state, session, now);
  daily.dueDone = session.dueDone;
  daily.newDone = session.newDone;
  return true;
}

function prepareSession(session, state, settings, now) {
  const time = now || Date.now();
  if (!session || !Array.isArray(session.queue) || session.mode === 'practice'
    || session.day !== dayKey(time)) return false;
  let changed = false;

  if (session.reviewPlanVersion !== REVIEW_PLAN_VERSION) {
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
    changed = true;
  }

  if (session.contextPlanVersion !== CONTEXT_PLAN_VERSION) {
    const completed = session.queue.slice(0, session.index);
    const remainingWithoutContext = session.queue.slice(session.index)
      .filter((item) => item.phase !== 'context');
    session.queue = completed.concat(remainingWithoutContext);
    session.contextPlanVersion = CONTEXT_PLAN_VERSION;
    completed
      .filter((item) => ['review', 'new'].includes(item.phase))
      .forEach((item) => {
        const card = state.cards[item.wordId];
        if (card && card.lastGrade && card.lastGrade !== 'easy') {
          queueContextCheck(session, getWord(item.wordId), card.lastGrade, time);
        }
      });
    changed = true;
  }
  if (questionOrder.prepare(session, state)) changed = true;
  if (studyOrder.reconcile(session, state)) changed = true;
  return changed;
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
    sentenceDone: previous.sentenceDone || 0,
    sentenceCorrect: previous.sentenceCorrect || 0,
    ratings: Object.assign({ again: 0, hard: 0, good: 0, easy: 0 }, previous.ratings || {}),
    elapsedSeconds: Math.max(0, (previous.minutes || 0) * 60),
    reviewPlanVersion: REVIEW_PLAN_VERSION,
    contextPlanVersion: CONTEXT_PLAN_VERSION,
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

  const session = makeSession(today, time, queue, daily, {
    dueGoal: (daily.dueDone || 0) + stats.scheduledDue.length,
    newGoal: (daily.newDone || 0) + newWords.length,
    batchNewGoal: newWords.length,
    extraNew: daily.extraNew || 0,
  });
  carry.attach(session, state, settings, [], time);
  questionOrder.prepare(session, state);
  studyOrder.reconcile(session, state);
  return session;
}

function rolloverSession(session, state, settings, now = Date.now()) {
  const day = timeLedger.dayKey(now);
  if (!session || !Array.isArray(session.queue) || session.mode === 'practice' || session.day === day) return false;
  // Preserve completed history and pending questions. Reconcile the remaining
  // words with today's unchanged limits, rather than grade yesterday again.
  const tail = session.queue.slice(session.index);
  const next = buildSession(state, settings, now);
  carry.attach(next, state, settings, tail, now);
  delete next.questionOrderVersion;
  questionOrder.prepare(next, state);
  studyOrder.reconcile(next, state);
  Object.keys(session).forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(next, key)) delete session[key];
  });
  Object.assign(session, next);
  metrics.commit(state, session, now);
  return true;
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

module.exports = {
  examCoverageDue,
  buildExtraSession,
  buildSession,
  prepareSession,
  repairSessionPlan,
  rolloverSession,
  progressStats,
  queueContextCheck,
  summarize,
};
