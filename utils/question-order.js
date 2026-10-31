// Spread pending questions through their own old/new section, keeping every
// original question and all answered history. This runs once per old save.
const metrics = require('./learning-metrics');
const { kindOf } = require('./study-order');
const isQuestion = item => item.phase === 'sentence' || item.phase === 'context';
const isRecall = item => ['review', 'new', 'reinforcement'].includes(item.phase);
function prepare(session, state) {
  if (!session || session.mode === 'practice' || session.questionOrderVersion === 1) return false;
  const prefix = session.queue.slice(0, session.index), tail = session.queue.slice(session.index);
  const plan = metrics.planFor(state, session, session.day);
  const seen = new Set(Object.keys((state.daily[session.day] || {}).firstAnswers || {}));
  const lastRecall = new Map();
  (state.recentReviews || []).filter(item => item.day === session.day && isRecall(item)).forEach(item => seen.add(item.wordId));
  Object.entries(state.cards).forEach(([id, card]) => { if (card.passedDay === session.day) seen.add(id); });
  prefix.forEach((item, index) => { if (isRecall(item)) { seen.add(item.wordId); lastRecall.set(item.wordId, index); } });
  const output = [];
  for (const kind of ['review', 'new']) {
    const group = tail.filter(item => kindOf(item, plan, state) === kind);
    const questions = group.filter(item => isQuestion(item) && !item.answered);
    const work = group.filter(item => !isQuestion(item) || item.answered);
    let distance = 0, threshold = 8;
    for (const item of work) {
      output.push(item);
      if (isRecall(item)) { seen.add(item.wordId); lastRecall.set(item.wordId, prefix.length + output.length - 1); }
      distance++;
      if (distance < threshold) continue;
      const position = prefix.length + output.length;
      const next = questions.findIndex(question => seen.has(question.wordId) && (!lastRecall.has(question.wordId) || position - lastRecall.get(question.wordId) >= 8));
      if (next >= 0) {
        output.push(questions.splice(next, 1)[0]); distance = 0; threshold = 3;
      }
    }
    questions.forEach(question => {
      if (!seen.has(question.wordId)) {
        // An unfinished question from yesterday cannot substitute for a real
        // recall today. Ask it; never invent a grade or erase the question.
        output.push({ wordId: question.wordId, phase: kind, reinforced: false });
        seen.add(question.wordId);
      }
      output.push(question);
    });
  }
  session.queue = prefix.concat(output);
  session.questionOrderVersion = 1;
  return true;
}
module.exports = { prepare };
