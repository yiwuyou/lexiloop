const { dayKey } = require('./date');
const migrations = require('./migrations');
const syncStorage = require('./sync-storage');
const wordIdentity = require('./word-identity');

const STATE_KEY = 'mem_vocab_state_v1';
const SESSION_KEY = 'mem_vocab_session_v1';
const PRACTICE_SESSION_KEY = 'mem_vocab_practice_session_v1';
const SETTINGS_KEY = 'mem_vocab_settings_v1';
const MIGRATION_BACKUP_KEY = 'mem_vocab_state_before_v2';
const APPLY_KEY = 'mem_vocab_cloud_apply_v1';
const ANSWER_KEY = 'mem_vocab_answer_apply_v1';
let changeListener = null;
let quiet = false;

function defaultState() {
  return {
    schemaVersion: migrations.CURRENT_STATE_SCHEMA,
    createdAt: Date.now(),
    cards: {},
    daily: {},
    weakBook: {},
    recentReviews: [],
  };
}

function defaultSettings() {
  return {
    schemaVersion: 2,
    dailyNewCount: 50,
    dailyMaxNewCount: 100,
    dailyReviewLimit: 100,
    reviewLimitVersion: 1,
    dailyBacklogLimit: 30,
    extraStep: 25,
    examDate: '2026-12-19', learningDeadline: '2026-12-18', examPlanVersion: 1,
  };
}

function safeGet(key, fallback) {
  try {
    const value = [STATE_KEY, SESSION_KEY, PRACTICE_SESSION_KEY, MIGRATION_BACKUP_KEY].includes(key) ? syncStorage.read(key) : wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    if ([STATE_KEY, SESSION_KEY, PRACTICE_SESSION_KEY].includes(key)) throw error;
    return fallback;
  }
}

function safeSet(key, value) {
  if ([STATE_KEY, SESSION_KEY, PRACTICE_SESSION_KEY, MIGRATION_BACKUP_KEY].includes(key)) syncStorage.write(key, value);
  else wx.setStorageSync(key, value);
  if (!quiet && changeListener && [STATE_KEY, SETTINGS_KEY, SESSION_KEY, PRACTICE_SESSION_KEY].includes(key)) {
    try { changeListener(); } catch (error) { /* Local save is still durable; next sync reconciles it. */ }
  }
  return value;
}

function loadState() {
  resumeAnswer();
  let state = safeGet(STATE_KEY, null);
  if (!state) {
    state = safeSet(STATE_KEY, defaultState());
  } else if (state.schemaVersion !== migrations.CURRENT_STATE_SCHEMA) {
    safeSet(MIGRATION_BACKUP_KEY, state);
    try {
      state = safeSet(STATE_KEY, migrations.migrateState(state));
    } catch (error) {
      // A failed migration leaves the original records available.
      return null;
    }
  }
  const merged = wordIdentity.mergeState(state);
  if (merged !== state) {
    const backupKey = 'mem_vocab_before_word_merge_v1';
    if (!syncStorage.read(backupKey)) syncStorage.write(backupKey, {
      at: Date.now(), state, session: safeGet(SESSION_KEY, null), practiceSession: safeGet(PRACTICE_SESSION_KEY, null),
    });
    state = safeSet(STATE_KEY, merged);
  }
  const settings = safeGet(SETTINGS_KEY, null);
  if (!settings) {
    safeSet(SETTINGS_KEY, defaultSettings());
  } else if (!settingsCurrent(settings)) {
    if (settings.examPlanVersion !== 1 && !wx.getStorageSync('mem_vocab_before_fsrs_v1')) {
      syncStorage.write('mem_vocab_before_fsrs_v1', { at: Date.now(), state, settings,
        session: safeGet(SESSION_KEY, null), practiceSession: safeGet(PRACTICE_SESSION_KEY, null) });
    }
    const next = Object.assign(defaultSettings(), settings, { schemaVersion: 2, reviewLimitVersion: 1 });
    if (settings.schemaVersion !== 2 || settings.reviewLimitVersion !== 1) next.dailyReviewLimit = 100;
    if (settings.examPlanVersion !== 1) Object.assign(next, { examDate: '2026-12-19', learningDeadline: '2026-12-18', examPlanVersion: 1 });
    safeSet(SETTINGS_KEY, next);
  }
  return state;
}

function settingsCurrent(settings) {
  return settings && settings.schemaVersion === 2 && settings.reviewLimitVersion === 1 && settings.examPlanVersion === 1;
}

function ensureState() { return Boolean(loadState()); }

function getState() {
  const state = loadState();
  if (!state) throw new Error('学习记录版本高于当前程序，请升级后重试');
  return state;
}

function saveState(state) {
  const next = Object.assign({}, wordIdentity.mergeState(state), { schemaVersion: migrations.CURRENT_STATE_SCHEMA });
  delete next.version;
  return safeSet(STATE_KEY, next);
}

function getSettings() {
  let settings = safeGet(SETTINGS_KEY, null);
  if (!settingsCurrent(settings)) {
    ensureState();
    settings = safeGet(SETTINGS_KEY, null);
  }
  return Object.assign(defaultSettings(), settings || {});
}

function saveSettings(settings) {
  return safeSet(SETTINGS_KEY, Object.assign(defaultSettings(), settings || {}, { schemaVersion: 2 }));
}

function getSession(mode) {
  resumeAnswer();
  return wordIdentity.mergeSession(safeGet(mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY, null));
}

function saveSession(session) {
  return safeSet(session.mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY, wordIdentity.mergeSession(session));
}

function clearSession(mode) {
  try {
    syncStorage.remove(mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY);
    if (!quiet && changeListener) changeListener();
  } catch (error) {
    // A failed cleanup must not discard completed review records.
  }
}

function writeAnswer(value) {
  try {
    syncStorage.write(STATE_KEY, value.state);
    const session = value.session;
    syncStorage.write(session.mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY, session);
    syncStorage.remove(ANSWER_KEY);
  } catch (error) {
    error.answerPending = true;
    throw error;
  }
  if (!quiet && changeListener) {
    try { changeListener(); } catch (error) { /* The answer is already durable. */ }
  }
}
function resumeAnswer() {
  const pending = syncStorage.read(ANSWER_KEY);
  if (!pending) return false;
  if (!migrations.validateState(pending.state) || !pending.session || !Array.isArray(pending.session.queue)) throw new Error('invalid-answer-journal');
  writeAnswer(pending);
  return true;
}
function saveAnswer(state, session) {
  resumeAnswer();
  const value = { state: wordIdentity.mergeState(state), session: wordIdentity.mergeSession(session) };
  syncStorage.write(ANSWER_KEY, value);
  writeAnswer(value);
}

function appendReview(state, review) {
  const entry = Object.assign({ id: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}` }, review);
  state.recentReviews = (state.recentReviews || []).concat(entry).slice(-3000);
}

function bundle() {
  return { state: getState(), settings: getSettings(), session: getSession(), practiceSession: getSession('practice') };
}
function writeBundle(value) {
  syncStorage.write(STATE_KEY, value.state);
  wx.setStorageSync(SETTINGS_KEY, value.settings);
  [[SESSION_KEY, value.session], [PRACTICE_SESSION_KEY, value.practiceSession]].forEach(([key, session]) => {
    if (session) syncStorage.write(key, wordIdentity.mergeSession(session)); else syncStorage.remove(key);
  });
}
function replaceBundle(value) {
  resumeAnswer();
  const next = Object.assign({}, value, { state: migrations.migrateState(value.state) });
  if (!next.settings || next.settings.schemaVersion !== 2) throw new Error('invalid-cloud-settings');
  quiet = true;
  try {
    // Complete an interrupted multi-key apply on the next launch.
    syncStorage.write(APPLY_KEY, next);
    writeBundle(next);
    syncStorage.remove(APPLY_KEY);
  } finally { quiet = false; }
}
function resumeCloudApply() {
  const pending = syncStorage.read(APPLY_KEY);
  if (pending) replaceBundle(pending);
}

function getTodaySummary(state, now) {
  return state.daily[dayKey(now)] || null;
}

module.exports = {
  bundle,
  replaceBundle,
  resumeCloudApply,
  onChange(listener) { changeListener = listener; },
  appendReview,
  clearSession,
  ensureState,
  getSession,
  getSettings,
  getState,
  getTodaySummary,
  saveSession,
  saveAnswer,
  resumeAnswer,
  saveSettings,
  saveState,
};
