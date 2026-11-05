const plan = require('./study-plan');
const ledger = require('./time-ledger');
const metrics = require('./learning-metrics');
const carry = require('./task-carry');
const questionOrder = require('./question-order');
const studyOrder = require('./study-order');
function rollover(session, state, settings, now = Date.now()) {
  const day = ledger.dayKey(now);
  if (!session || session.mode === 'practice' || session.day === day) return false;
  // Preserve completed history and pending questions. Reconcile the remaining
  // words with today's unchanged limits, rather than grade yesterday again.
  const tail = session.queue.slice(session.index);
  const next = plan.buildSession(state, settings, now);
  carry.attach(next, state, settings, tail, now);
  delete next.questionOrderVersion;
  questionOrder.prepare(next, state);
  studyOrder.reconcile(next, state);
  Object.assign(session, next);
  metrics.commit(state, session, now);
  return true;
}
module.exports = { rollover };
