const plan = require('./study-plan');
const ledger = require('./time-ledger');
const metrics = require('./learning-metrics');
function rollover(session, state, settings, now = Date.now()) {
  const day = ledger.dayKey(now);
  if (!session || session.mode === 'practice' || session.day === day) return false;
  // Preserve completed history and pending questions. Reconcile the remaining
  // words with today's unchanged limits, rather than grade yesterday again.
  const tail = session.queue.slice(session.index);
  const next = plan.buildSession(state, settings, now);
  require('./task-carry').attach(next, state, settings, tail, now);
  Object.assign(session, next);
  metrics.commit(state, session, now);
  return true;
}
module.exports = { rollover };
