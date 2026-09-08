const { DAY_MS, dayKey, startOfDay } = require('./date');

const MINUTE_MS = 60 * 1000;

const GRADE = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
};

function initialState() {
  return {
    seen: false,
    reps: 0,
    lapses: 0,
    interval: 0,
    ease: 2.4,
    dueAt: 0,
    lastAt: 0,
    lastGrade: '',
    hardStreak: 0,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function review(previous, grade, now) {
  const time = now || Date.now();
  const state = Object.assign(initialState(), previous || {});
  const firstReview = !state.seen || state.reps === 0;
  let interval = state.interval || 0;
  let ease = state.ease || 2.4;
  let dueAt;
  let lapses = state.lapses || 0;
  const today = dayKey(time);
  const failed = grade === GRADE.AGAIN || grade === GRADE.HARD;
  const failedToday = failed || state.failedDay === today;
  const sameDaySuccess = state.passedDay === today;

  if (grade === GRADE.AGAIN) {
    interval = 0;
    ease = clamp(ease - 0.2, 1.3, 3.0);
    dueAt = time + 10 * MINUTE_MS;
    lapses += 1;
  } else if (grade === GRADE.HARD) {
    interval = firstReview ? 1 : Math.max(1, Math.round(interval * 1.25));
    ease = clamp(ease - 0.08, 1.3, 3.0);
    dueAt = time + interval * DAY_MS;
  } else if (grade === GRADE.EASY) {
    interval = firstReview ? 7 : Math.max(interval + 2, Math.round(interval * ease * 1.3));
    ease = clamp(ease + 0.12, 1.3, 3.0);
    dueAt = time + interval * DAY_MS;
  } else {
    interval = firstReview ? 3 : Math.max(interval + 1, Math.round(interval * ease));
    dueAt = time + interval * DAY_MS;
  }

  // Within-session repetitions are not independent spaced successes.
  if (!failed && failedToday) {
    interval = 1;
    dueAt = startOfDay(time) + DAY_MS;
    ease = state.ease;
  } else if (!failed && sameDaySuccess) {
    interval = state.interval;
    dueAt = state.dueAt;
    ease = state.ease;
  }
  return Object.assign({}, state, {
    seen: true,
    reps: state.reps + 1,
    lapses,
    interval,
    ease: Number(ease.toFixed(2)),
    dueAt,
    lastAt: time,
    lastGrade: grade,
    hardStreak: grade === GRADE.HARD ? Number(state.hardStreak || 0) + 1 : 0,
    needsRecall: failed,
    failedDay: failed ? today : state.failedDay || '',
    passedDay: failed ? state.passedDay || '' : today,
  });
}

function isWeak(state) {
  return Boolean(state && state.seen && (state.lapses >= 2 || state.lastGrade === GRADE.AGAIN));
}

function isStable(state) {
  return Boolean(state && state.seen && state.interval >= 14 && state.lastGrade !== GRADE.AGAIN);
}

module.exports = { GRADE, initialState, isStable, isWeak, review };
