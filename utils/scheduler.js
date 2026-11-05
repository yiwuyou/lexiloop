const { DAY_MS, dayKey, startOfDay } = require('./date');
const GRADE = { AGAIN: 'again', HARD: 'hard', GOOD: 'good', EASY: 'easy' };
let engine;
// This module ships in the main package, so opening the study page does not
// wait for a separate download or a desktop runtime's async require callback.
function loadEngine() { return engine || (engine = require('../scheduler-data/ready')); }
function prepare() { return Promise.resolve().then(loadEngine); }
function initialState() { return { seen: false, reps: 0, lapses: 0, interval: 0, ease: 2.4, dueAt: 0, lastAt: 0, lastGrade: '', hardStreak: 0 }; }
function review(previous, grade, now) {
  if (!Object.values(GRADE).includes(grade)) throw new Error('invalid-grade');
  loadEngine();
  const time = now || Date.now(), today = dayKey(time);
  const state = Object.assign(initialState(), previous || {});
  const failed = grade === 'again' || grade === 'hard';
  const validModel = state.fsrsVersion === engine.version && state.fsrs;
  // Old ease/interval values are not fabricated FSRS histories. A card enters
  // the model at its next actual answer, without resetting learned progress.
  const repeatedSuccess = !failed && state.passedDay === today && validModel;
  let model = repeatedSuccess
    ? state.fsrs : JSON.parse(JSON.stringify(engine.review(validModel || null, grade, time)));
  let dueAt = new Date(model.due).getTime();
  let interval = Number(model.scheduled_days || 0);
  if (!failed && !repeatedSuccess && (state.failedDay === today || state.needsContext)) {
    dueAt = Math.min(dueAt, startOfDay(time) + DAY_MS); interval = Math.max(0, (dueAt - time) / DAY_MS);
    model = Object.assign({}, model, { due: new Date(dueAt).toISOString(), scheduled_days: interval });
  }
  return Object.assign({}, state, {
    seen: true, reps: state.reps + 1, lapses: state.lapses + (grade === 'again' ? 1 : 0),
    interval, dueAt, lastAt: time, lastGrade: grade,
    hardStreak: grade === 'hard' ? Number(state.hardStreak || 0) + 1 : 0,
    needsRecall: failed, failedDay: failed ? today : state.failedDay || '', passedDay: failed ? state.passedDay || '' : today,
    fsrs: model, fsrsVersion: engine.version, fsrsNeedsRecheck: false,
  });
}
function isWeak(state) { return Boolean(state && state.seen && (state.lapses >= 2 || state.lastGrade === 'again')); }
function isStable(state) { return Boolean(state && state.seen && state.interval >= 14 && !state.needsRecall && state.lastGrade !== 'again'); }
function isRecoveryPending(state) { return Boolean(state && state.seen && state.recoveredAt && !Number(state.reps || 0)); }
module.exports = { GRADE, initialState, isRecoveryPending, isStable, isWeak, review, prepare };
