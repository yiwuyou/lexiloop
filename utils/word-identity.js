// Stable source IDs remain aliases for the first occurrence of each word.
const groups = [
  ['c-1-11', 'c-2-6'],
  ['c-1-18', 'c-9-27'],
  ['c-1-20', 'c-3-5', 'h-9-31'],
  ['c-1-21', 'c-4-39'],
  ['c-1-22', 'c-3-28'],
  ['c-3-37', 'h-13-9'],
  ['c-3-39', 'h-13-18'],
];
const aliases = {};
groups.forEach(ids => ids.slice(1).forEach(id => { aliases[id] = ids[0]; }));
const canonicalId = id => aliases[id] || id;
const clone = value => JSON.parse(JSON.stringify(value));
const isAlias = id => Boolean(aliases[id]);
const preferKind = (left, right) => left === 'new' || right === 'new' ? 'new' : right;
function mergeMap(values, choose = (left, right) => right) {
  const result = {};
  Object.entries(values || {}).forEach(([id, value]) => {
    const key = canonicalId(id);
    result[key] = Object.prototype.hasOwnProperty.call(result, key) ? choose(result[key], value) : value;
  });
  return result;
}
const kindCount = (values, kind) => Object.values(values || {}).filter(value => value === kind).length;
function latest(left, right) {
  return (left.at || 0) > (right.at || 0) ? left : right;
}
function chooseCard(left, right) {
  // Keep one complete model from a real answer, rather than combining FSRS fields.
  if (Boolean(left.reps) !== Boolean(right.reps)) return left.reps ? left : right;
  if (Boolean(left.seen) !== Boolean(right.seen)) return left.seen ? left : right;
  if ((left.lastAt || 0) !== (right.lastAt || 0)) return (left.lastAt || 0) > (right.lastAt || 0) ? left : right;
  if (Boolean(left.needsRecall) !== Boolean(right.needsRecall)) return left.needsRecall ? left : right;
  return (left.dueAt || 0) <= (right.dueAt || 0) ? left : right;
}
function mergeCarry(records) {
  const result = {};
  Object.entries(records || {}).forEach(([key, record]) => {
    const parts = key.split(':');
    parts[0] = canonicalId(parts[0]);
    if (parts[2] && parts[2].startsWith('recall-')) parts[2] = 'recall-' + canonicalId(parts[2].slice(7));
    const mapped = record.item ? Object.assign({}, record, {
      item: Object.assign({}, record.item, { wordId: canonicalId(record.item.wordId) }),
    }) : record;
    const target = parts.join(':');
    result[target] = result[target] ? latest(result[target], mapped) : mapped;
  });
  return result;
}
function mergeState(source) {
  const days = Object.values(source.daily || {});
  const hasAliases = Object.keys(source.cards || {}).some(isAlias)
    || Object.keys(source.weakBook || {}).some(isAlias)
    || (source.recentReviews || []).some(item => isAlias(item.wordId))
    || Object.values(source.sentenceBook || {}).some(item => isAlias(item.wordId))
    || days.some(day => ['taskPlan', 'firstAnswers', 'firstOverdue', 'taskStatus'].some(key => Object.keys(day[key] || {}).some(isAlias))
      || ['review', 'excluded'].some(key => Object.keys((day.taskPlanCorrection || {})[key] || {}).some(isAlias))
      || Object.keys(day.carryTasks || {}).some(key => isAlias(key.split(':')[0])));
  if (!hasAliases) return source;
  const state = clone(source);
  state.cards = mergeMap(state.cards, chooseCard);
  state.weakBook = mergeMap(state.weakBook, (left, right) => (left.addedAt || 0) <= (right.addedAt || 0) ? left : right);
  state.recentReviews.forEach(item => { item.wordId = canonicalId(item.wordId); });
  Object.values(state.sentenceBook || {}).forEach(item => { item.wordId = canonicalId(item.wordId); });
  Object.entries(state.daily).forEach(([date, day]) => {
    const oldPlan = day.taskPlan, oldAnswers = day.firstAnswers, oldOverdue = day.firstOverdue;
    if (oldPlan) day.taskPlan = mergeMap(oldPlan, preferKind);
    if (oldAnswers) {
      day.firstAnswers = mergeMap(oldAnswers, preferKind);
      Object.keys(day.firstAnswers).forEach(id => {
        if (day.taskPlan && day.taskPlan[id]) day.firstAnswers[id] = day.taskPlan[id];
      });
    }
    if (oldOverdue) day.firstOverdue = mergeMap(oldOverdue, (left, right) => left || right);
    if (day.taskStatus) day.taskStatus = mergeMap(day.taskStatus, (left, right) =>
      left.at === right.at ? (left.passed ? right : left) : latest(left, right));
    if (day.carryTasks) day.carryTasks = mergeCarry(day.carryTasks);
    const affected = ['taskPlan', 'firstAnswers', 'firstOverdue', 'taskStatus']
      .some(key => Object.keys(source.daily[date][key] || {}).some(isAlias));
    if (affected || day.wordMergeOffsets) {
      const offsets = day.wordMergeOffsets || (day.wordMergeOffsets = {});
      const fields = [
        ['dueGoal', oldPlan, day.taskPlan, 'review'], ['newGoal', oldPlan, day.taskPlan, 'new'],
        ['dueDone', oldAnswers, day.firstAnswers, 'review'], ['newDone', oldAnswers, day.firstAnswers, 'new'],
        ['backlogDone', oldOverdue, day.firstOverdue, null],
      ];
      fields.forEach(([field, beforeMap, afterMap, kind]) => {
        if (day[field] == null || !beforeMap) return;
        const count = values => kind ? kindCount(values, kind) : Object.keys(values || {}).length;
        if (offsets[field] == null) offsets[field] = Math.max(0, day[field] - count(beforeMap));
        day[field] = offsets[field] + count(afterMap);
      });
    }
    if (day.taskPlanCorrection) {
      // An excluded old occurrence must not exclude the surviving card.
      const correction = day.taskPlanCorrection;
      correction.excluded = Object.fromEntries(Object.entries(correction.excluded || {}).filter(([id]) => !isAlias(id)));
      if (correction.review) correction.review = mergeMap(correction.review);
    }
  });
  return state;
}
function mergeSession(source) {
  if (!source || !Array.isArray(source.queue) || !source.queue.some(item => isAlias(item.wordId))
      && !Object.keys(source.taskPlan || {}).some(isAlias)) return source;
  const session = clone(source);
  const oldPlan = session.taskPlan || Object.fromEntries(session.queue
    .filter(item => item.phase === 'review' || item.phase === 'new').map(item => [item.wordId, item.phase]));
  const plan = mergeMap(oldPlan, preferKind);
  const completed = session.queue.slice(0, session.index);
  const answeredBase = new Set(completed.filter(item => item.phase === 'review' || item.phase === 'new')
    .map(item => canonicalId(item.wordId)));
  const origins = new Map();
  const tail = session.queue.slice(session.index).filter(item => {
    const id = canonicalId(item.wordId);
    const base = item.phase === 'review' || item.phase === 'new';
    if (base && answeredBase.has(id)) return false;
    const key = id + ':' + (base ? 'base' : item.phase) + ':' + (item.phase === 'context' ? item.questionId : '');
    const previous = origins.get(key);
    if (previous && previous !== item.wordId) return false;
    origins.set(key, item.wordId);
    return true;
  });
  session.queue = completed.concat(tail).map(item => Object.assign({}, item, { wordId: canonicalId(item.wordId) }));
  // Keep old question IDs and selected choices so an open question retains its order.
  session.taskPlan = plan;
  const oldAnswers = Object.fromEntries(completed.filter(item => item.phase === 'review' || item.phase === 'new')
    .map(item => [item.wordId, item.phase]));
  const answers = mergeMap(oldAnswers, preferKind);
  Object.keys(answers).forEach(id => { if (plan[id]) answers[id] = plan[id]; });
  [['dueDone', 'review'], ['newDone', 'new']].forEach(([field, kind]) => {
    if (session[field] != null) session[field] = Math.max(0, session[field] - kindCount(oldAnswers, kind) + kindCount(answers, kind));
  });
  [['dueGoal', 'review'], ['newGoal', 'new']].forEach(([field, kind]) => {
    if (session[field] != null) session[field] = Math.max(0, session[field] - kindCount(oldPlan, kind) + kindCount(plan, kind));
  });
  if (session.answers) session.answers.forEach(item => { item.wordId = canonicalId(item.wordId); });
  return session;
}
module.exports = { groups, canonicalId, mergeState, mergeSession };
