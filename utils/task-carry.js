// Carry unfinished questions without expanding the fixed daily word limits.
function key(item) { return [item.wordId, item.phase, item.questionId || ''].join(':'); }
function attach(session, state, settings, extra = [], now = Date.now()) {
  const queued = new Map();
  Object.values(state.daily).forEach(day => Object.values(day.carryTasks || {}).forEach(record => {
    if (record.item) queued.set(key(record.item), record.item);
  }));
  extra.filter(item => !item.answered).forEach(item => queued.set(key(item), item));
  if (!queued.size) return session;
  const pending = [...queued.values()];
  const previous = state.daily[session.day] || {};
  const capacity = Math.max(0, (settings.dailyReviewLimit || 100) - (previous.dueDone || 0));
  const carryReview = [...new Set(pending.filter(item => state.cards[item.wordId] && state.cards[item.wordId].seen).map(item => item.wordId))];
  const start = Date.parse(session.day + 'T00:00:00+08:00');
  let backlog = Math.max(0, (settings.dailyBacklogLimit || 30) - (previous.backlogDone || 0));
  const overdueIds = new Set();
  const review = [];
  [...new Set(carryReview.concat(session.queue.filter(item => item.phase === 'review').map(item => item.wordId)))].forEach(id => {
    const card = state.cards[id] || {};
    const overdue = card.dueAt < start && !require('./scheduler').isRecoveryPending(card);
    if (review.length >= capacity || overdue && !backlog) return;
    if (overdue) { backlog--; overdueIds.add(id); }
    review.push(id);
  });
  const newWords = session.queue.filter(item => item.phase === 'new');
  const selected = new Set(review.concat(newWords.map(item => item.wordId)));
  session.taskPlan = Object.fromEntries(review.map(id => [id, 'review']).concat(newWords.map(item => [item.wordId, 'new'])));
  const continuing = pending.filter(item => selected.has(item.wordId)).map(item => Object.assign({}, item, { overdue: overdueIds.has(item.wordId) }));
  const known = new Set(continuing.map(item => item.wordId));
  const needBase = new Set(continuing.filter(item => !continuing.some(other => other.wordId === item.wordId && ['review', 'new', 'reinforcement'].includes(other.phase))).map(item => item.wordId));
  const queue = continuing.flatMap(item => {
    if (!needBase.has(item.wordId)) return [item];
    needBase.delete(item.wordId);
    return [{wordId:item.wordId,phase:session.taskPlan[item.wordId],reinforced:false,overdue:overdueIds.has(item.wordId)},item];
  });
  session.queue = queue.concat(review.filter(id => !known.has(id)).map(wordId => ({wordId,phase:'review',reinforced:false,overdue:overdueIds.has(wordId)})), newWords.filter(item => !known.has(item.wordId)));
  session.dueGoal = (previous.dueDone || 0) + review.length;
  const daily = state.daily[session.day] || (state.daily[session.day] = {});
  daily.carryTasks = daily.carryTasks || {};
  pending.forEach(item => { daily.carryTasks[key(item)] = {at:now,item}; });
  return session;
}
function complete(state, session, now) {
  const status = state.daily[session.day].taskStatus || {};
  Object.values(state.daily).forEach(day => Object.entries(day.carryTasks || {}).forEach(([id, record]) => {
    if (record.item && status[record.item.wordId] && status[record.item.wordId].passed) day.carryTasks[id] = {at:now,item:null};
  }));
}
module.exports = { attach, complete };
