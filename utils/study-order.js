// Keep every task for today's review words ahead of today's new words.
// Only the pending tail moves: answered history, grades and daily goals stay intact.
const metrics = require('./learning-metrics');
function kindOf(item, plan, state) {
  if (plan[item.wordId]) return plan[item.wordId];
  if (item.phase === 'review' || item.phase === 'new') return item.phase;
  return state.cards[item.wordId] && state.cards[item.wordId].seen ? 'review' : 'new';
}
function kind(state, session, item) { return kindOf(item, metrics.planFor(state, session, session.day), state); }
function reconcile(session, state) {
  if (!session || session.mode === 'practice' || !Array.isArray(session.queue)) return false;
  const before = session.queue.slice();
  // A word whose last required question finished can still need independent
  // recall. Recover it before allowing the first new word, including old saves.
  metrics.recover(state, session);
  const plan = metrics.planFor(state, session, session.day);
  const tail = session.queue.slice(session.index), review = [], fresh = [];
  tail.forEach(item => (kindOf(item, plan, state) === 'review' ? review : fresh).push(item));
  const next = session.queue.slice(0, session.index).concat(review, fresh);
  const changed = before.length !== next.length || next.some((item, index) => before[index] !== item);
  if (changed) session.queue = next;
  return changed;
}
module.exports = { reconcile, kind, kindOf };
