const { DAY_MS } = require('./date');

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

  return {
    seen: true,
    reps: state.reps + 1,
    lapses,
    interval,
    ease: Number(ease.toFixed(2)),
    dueAt,
    lastAt: time,
    lastGrade: grade,
  };
}

function isWeak(state) {
  return Boolean(state && state.seen && (state.lapses >= 2 || state.lastGrade === GRADE.AGAIN));
}

function isStable(state) {
  return Boolean(state && state.seen && state.interval >= 14 && state.lastGrade !== GRADE.AGAIN);
}

module.exports = { GRADE, initialState, isStable, isWeak, review };
