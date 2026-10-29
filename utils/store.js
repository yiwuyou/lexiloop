const { dayKey } = require('./date');
const migrations = require('./migrations');
const syncStorage = require('./sync-storage');

const STATE_KEY = 'mem_vocab_state_v1';
const SESSION_KEY = 'mem_vocab_session_v1';
const PRACTICE_SESSION_KEY = 'mem_vocab_practice_session_v1';
const SETTINGS_KEY = 'mem_vocab_settings_v1';
const MIGRATION_BACKUP_KEY = 'mem_vocab_state_before_v2';
const APPLY_KEY = 'mem_vocab_cloud_apply_v1';
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
    const value = [STATE_KEY, SESSION_KEY, PRACTICE_SESSION_KEY].includes(key) ? syncStorage.read(key) : wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    if ([STATE_KEY, SESSION_KEY, PRACTICE_SESSION_KEY].includes(key)) throw error;
    return fallback;
  }
}

function safeSet(key, value) {
  if ([STATE_KEY, SESSION_KEY, PRACTICE_SESSION_KEY].includes(key)) syncStorage.write(key, value);
  else wx.setStorageSync(key, value);
  if (!quiet && changeListener && [STATE_KEY, SETTINGS_KEY, SESSION_KEY, PRACTICE_SESSION_KEY].includes(key)) {
    try { changeListener(); } catch (error) { /* Local save is still durable; next sync reconciles it. */ }
  }
  return value;
}

function ensureState() {
  const state = safeGet(STATE_KEY, null);
  if (!state) {
    safeSet(STATE_KEY, defaultState());
  } else if (state.schemaVersion !== migrations.CURRENT_STATE_SCHEMA) {
    safeSet(MIGRATION_BACKUP_KEY, state);
    try {
      safeSet(STATE_KEY, migrations.migrateState(state));
    } catch (error) {
      // Keep the original state untouched. A future/newer schema must never be
      // silently replaced with an empty learning history.
      return false;
    }
  }
  const settings = safeGet(SETTINGS_KEY, null);
  if (settings && settings.examPlanVersion !== 1) {
    const backupKey = 'mem_vocab_before_fsrs_v1';
    if (!wx.getStorageSync(backupKey)) syncStorage.write(backupKey, { at: Date.now(), state: safeGet(STATE_KEY, null), settings,
      session: safeGet(SESSION_KEY, null), practiceSession: safeGet(PRACTICE_SESSION_KEY, null) });
  }
  if (!settings) {
    safeSet(SETTINGS_KEY, defaultSettings());
  } else if (settings.schemaVersion !== 2 || settings.reviewLimitVersion !== 1) {
    safeSet(SETTINGS_KEY, Object.assign(defaultSettings(), settings, {
      schemaVersion: 2, dailyReviewLimit: 100, reviewLimitVersion: 1,
    }));
  }
  const currentSettings = safeGet(SETTINGS_KEY, null);
  if (currentSettings && settings && settings.examPlanVersion !== 1) {
    safeSet(SETTINGS_KEY, Object.assign({}, currentSettings, { examDate: '2026-12-19', learningDeadline: '2026-12-18', examPlanVersion: 1 }));
  }
  return true;
}

function getState() {
  const ready = ensureState();
  const state = safeGet(STATE_KEY, null);
  if (ready === false) throw new Error('学习记录版本高于当前程序，请升级后重试');
  return state || defaultState();
}

function saveState(state) {
  const next = Object.assign({}, state, { schemaVersion: migrations.CURRENT_STATE_SCHEMA });
  delete next.version;
  return safeSet(STATE_KEY, next);
}

function getSettings() {
  ensureState();
  return Object.assign(defaultSettings(), safeGet(SETTINGS_KEY, {}));
}

function saveSettings(settings) {
  return safeSet(SETTINGS_KEY, Object.assign(defaultSettings(), settings || {}, { schemaVersion: 2 }));
}

function getSession(mode) {
  return safeGet(mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY, null);
}

function saveSession(session) {
  return safeSet(session.mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY, session);
}

function clearSession(mode) {
  try {
    syncStorage.remove(mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY);
    if (!quiet && changeListener) changeListener();
  } catch (error) {
    // A failed cleanup must not discard completed review records.
  }
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
    if (session) syncStorage.write(key, session); else syncStorage.remove(key);
  });
}
function replaceBundle(value) {
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
  saveSettings,
  saveState,
};
