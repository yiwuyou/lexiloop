const ledger = require('./time-ledger');
const DEFAULT_SECONDS = { review: 15, new: 32, reinforcement: 16, sentence: 28, context: 28, practice: 15, detail: 20 };
function planFor(state, session, day) {
  const daily = state.daily[day] || {};
  const plan = Object.assign({}, daily.taskPlan || {});
  (state.recentReviews || []).filter(r => r.day === day && ['review', 'new'].includes(r.phase))
    .forEach(r => { if (!plan[r.wordId]) plan[r.wordId] = r.phase; });
  if (session && session.day === day && session.mode !== 'practice') {
    Object.entries(session.taskPlan || {}).forEach(([id, kind]) => { if (!plan[id]) plan[id] = kind; });
    session.queue.filter(r => ['review', 'new'].includes(r.phase)).forEach(r => { if (!plan[r.wordId]) plan[r.wordId] = r.phase; });
  }
  return plan;
}
function pending(session, id) {
  return pendingIds(session).has(id);
}
function pendingIds(session) {
  return new Set(session ? session.queue.slice(session.index).filter(item =>
    (!(item.phase === 'sentence' || item.phase === 'context') || !item.answered || !item.correct)).map(item => item.wordId) : []);
}
function passed(state, session, id, day, pendingSet) {
  const card = state.cards[id];
  return Boolean(card && card.passedDay === day && !card.needsRecall && !card.needsContext && !(pendingSet || pendingIds(session)).has(id));
}
function rates(state, now) {
  const totals = {}, counts = {};
  const days = Object.keys(state.daily).filter(day => day >= ledger.dayKey(now - 7 * 86400000) && day < ledger.dayKey(now));
  days.forEach(day => {
    const daily = state.daily[day]; if (!daily.time) return;
    const time = ledger.summary(daily, day);
    const records = (state.recentReviews || []).filter(r => r.day === day);
    ledger.PHASES.forEach(phase => {
      const count = records.filter(r => r.phase === phase).length;
      const expected = daily[{ review: 'dueDone', new: 'newDone', reinforcement: 'reinforcementDone', sentence: 'sentenceDone', context: 'contextDone' }[phase]] || 0;
      if (count < expected) return; // The 3000-record window is not a complete day.
      if (count && time.phases[phase]) { totals[phase] = (totals[phase] || 0) + time.phases[phase]; counts[phase] = (counts[phase] || 0) + count; }
    });
  });
  const result = Object.assign({}, DEFAULT_SECONDS);
  Object.keys(totals).forEach(phase => { if (counts[phase] >= 20) result[phase] = Math.max(5, Math.min(90, totals[phase] / counts[phase])); });
  return result;
}
function range(seconds) {
  if (!seconds) return '已完成';
  const low = Math.max(1, Math.ceil(seconds * .85 / 60)), high = Math.max(low + 1, Math.ceil(seconds * 1.3 / 60));
  return '约' + low + '–' + high + '分钟';
}
function estimate(state, session, goals, now) {
  const speed = rates(state, now);
  let seconds = 0;
  if (session && session.index < session.queue.length) {
    session.queue.slice(session.index).forEach(item => { if (!item.answered) seconds += speed[item.phase] || 20; });
    // Unanswered base words can still generate extra work. Include a conservative
    // allowance, calibrated to recent reinforcement/question burden when known.
    const base = session.queue.slice(session.index).filter(item => ['new', 'review'].includes(item.phase)).length;
    const recent = (state.recentReviews || []).filter(r => r.at >= now - 7 * 86400000);
    const first = recent.filter(r => ['new', 'review'].includes(r.phase)).length;
    const extra = recent.filter(r => ['reinforcement', 'sentence', 'context'].includes(r.phase)).length;
    seconds += base * Math.min(3, first >= 20 ? extra / first : .8) * 22;
  } else if (!session) seconds = goals.review * (speed.review + 14) + goals.new * (speed.new + 22);
  return { seconds: Math.ceil(seconds), text: range(seconds) };
}
function commit(state, session, now = Date.now()) {
  const day = session.day;
  const daily = state.daily[day] || (state.daily[day] = {});
  daily.taskPlan = planFor(state, session, day);
  const first = daily.firstAnswers || {};
  const overdue = daily.firstOverdue || {};
  const seed = (id, late) => { if (daily.taskPlan[id]) first[id] = daily.taskPlan[id]; if (late && daily.taskPlan[id] === 'review') overdue[id] = true; };
  (state.recentReviews || []).filter(r => r.day === day && ['review', 'new', 'reinforcement'].includes(r.phase)).forEach(r => seed(r.wordId, r.overdue));
  session.queue.slice(0, session.index).filter(r => ['review', 'new', 'reinforcement'].includes(r.phase)).forEach(r => seed(r.wordId, r.overdue));
  const count = kind => Object.values(first).filter(value => value === kind).length;
  if (!daily.firstAnswerOffset) daily.firstAnswerOffset = {
    review: Math.max(0, (daily.dueDone || 0) - count('review')),
    new: Math.max(0, (daily.newDone || 0) - count('new')),
    backlog: Math.max(0, (daily.backlogDone || 0) - Object.keys(overdue).length),
  };
  daily.firstAnswers = first;
  daily.firstOverdue = overdue;
  session.backlogDone = Object.keys(overdue).length + (daily.firstAnswerOffset.backlog || 0);
  session.dueDone = count('review') + daily.firstAnswerOffset.review;
  session.newDone = count('new') + daily.firstAnswerOffset.new;
  daily.taskStatus = daily.taskStatus || {};
  const pendingSet = pendingIds(session);
  Object.keys(daily.taskPlan).forEach(id => {
    const success = passed(state, session, id, day, pendingSet), previous = daily.taskStatus[id];
    if (!previous || previous.passed !== success) daily.taskStatus[id] = { at: now, passed: success };
  });
  require('./task-carry').complete(state, session, now);
  if (!daily.initialEstimate) {
    daily.initialEstimate = { at: now, seconds: estimate(state, session, { review: 0, new: 0 }, now).seconds, rough: true, resumed: session.index > 0 };
  }
  return daily;
}
function summary(state, session, day = ledger.dayKey(Date.now()), preview) {
  const daily = state.daily[day] || {};
  const current = session && session.day === day && session.mode !== 'practice' ? session : null;
  const plan = planFor(state, current, day);
  if (!Object.keys(plan).length && preview) {
    preview.scheduledDue.forEach(w => { plan[w.id] = 'review'; });
    preview.unseen.slice(0, preview.newCount).forEach(w => { plan[w.id] = 'new'; });
  }
  const result = { reviewGoal: 0, newGoal: 0, reviewPassed: 0, newPassed: 0 };
  const pendingSet = pendingIds(current);
  Object.entries(plan).forEach(([id, kind]) => {
    result[kind === 'new' ? 'newGoal' : 'reviewGoal']++;
    const ok = current ? passed(state, current, id, day, pendingSet) : daily.taskStatus && daily.taskStatus[id]
      ? daily.taskStatus[id].passed : Boolean(daily.completedAt && state.cards[id] && state.cards[id].passedDay === day && !state.cards[id].needsRecall && !state.cards[id].needsContext);
    if (ok) result[kind === 'new' ? 'newPassed' : 'reviewPassed']++;
  });
  result.reviewGoal = Math.max(result.reviewGoal, daily.dueGoal || 0, current && current.dueGoal || 0);
  result.newGoal = Math.max(result.newGoal, daily.newGoal || 0, current && current.newGoal || 0);
  result.total = result.reviewGoal + result.newGoal;
  result.done = result.reviewPassed + result.newPassed;
  result.remaining = Math.max(0, result.total - result.done);
  result.percent = result.total ? Math.round(result.done / result.total * 100) : 0;
  result.reviewRemaining = result.reviewGoal - result.reviewPassed;
  result.newRemaining = result.newGoal - result.newPassed;
  // Visible word counts describe work actually done, not whether every later
  // question is finished. Failed answers still count as a reviewed word once.
  const first = Object.assign({}, daily.firstAnswers);
  const remember = item => { if (plan[item.wordId] && ['review', 'new', 'reinforcement'].includes(item.phase)) first[item.wordId] = plan[item.wordId]; };
  (state.recentReviews || []).filter(item => item.day === day).forEach(remember);
  if (current) current.queue.slice(0, current.index).forEach(remember);
  const count = kind => Object.values(first).filter(value => value === kind).length;
  const offset = daily.firstAnswerOffset || {};
  result.reviewSeen = Math.min(result.reviewGoal, Math.max(result.reviewPassed, daily.dueDone || 0, current && current.dueDone || 0, count('review') + (offset.review || 0)));
  result.newSeen = Math.min(result.newGoal, Math.max(result.newPassed, daily.newDone || 0, current && current.newDone || 0, count('new') + (offset.new || 0)));
  result.reviewUnseen = result.reviewGoal - result.reviewSeen;
  result.newUnseen = result.newGoal - result.newSeen;
  result.reviewPending = Math.max(0, result.reviewSeen - result.reviewPassed);
  result.newPending = Math.max(0, result.newSeen - result.newPassed);
  result.reviewPercent = result.reviewGoal ? Math.round(result.reviewSeen / result.reviewGoal * 100) : 0;
  result.newPercent = result.newGoal ? Math.round(result.newSeen / result.newGoal * 100) : 0;
  result.legacy = Object.keys(plan).length < result.total || (!daily.taskPlan && Boolean(daily.dueDone || daily.newDone));
  return result;
}
function recover(state, session) {
  const plan = planFor(state, session, session.day);
  const waiting = pendingIds(session);
  Object.entries(plan).forEach(([id, kind]) => {
    if (passed(state, session, id, session.day, waiting) || waiting.has(id)) return;
    const card = state.cards[id];
    const questionId = card && card.needsContext;
    const phase = questionId && !card.needsRecall && card.passedDay === session.day ? 'context' : card && card.seen ? 'reinforcement' : kind;
    session.queue.push({ wordId:id, phase, questionId:phase === 'context' ? questionId : undefined, reinforced:true });
    waiting.add(id);
  });
}
function section(task, kind) {
  return kind === 'new'
    ? { label: '新词学习', verb: '已学', done: task.newSeen, total: task.newGoal, percent: task.newPercent, pending: task.newPending }
    : { label: '旧词复习', verb: '已复习', done: task.reviewSeen, total: task.reviewGoal, percent: task.reviewPercent, pending: task.reviewPending };
}
module.exports = { section, planFor, pending, passed, commit, summary, estimate, range, recover };
