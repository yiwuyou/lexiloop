const { dayKey } = require('./date');
const migrations = require('./migrations');

const STATE_KEY = 'mem_vocab_state_v1';
const SESSION_KEY = 'mem_vocab_session_v1';
const PRACTICE_SESSION_KEY = 'mem_vocab_practice_session_v1';
const SETTINGS_KEY = 'mem_vocab_settings_v1';
const MIGRATION_BACKUP_KEY = 'mem_vocab_state_before_v2';

function defaultState() {
  return {
    schemaVersion: migrations.CURRENT_STATE_SCHEMA,
    createdAt: Date.now(),
    cards: {},
    daily: {},
    recentReviews: [],
  };
}

function defaultSettings() {
  return {
    schemaVersion: 2,
    dailyNewCount: 50,
    dailyMaxNewCount: 100,
    extraStep: 25,
    examDate: '2026-12-15',
  };
}

function safeGet(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function safeSet(key, value) {
  wx.setStorageSync(key, value);
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
  if (!settings) {
    safeSet(SETTINGS_KEY, defaultSettings());
  } else if (settings.schemaVersion !== 2) {
    safeSet(SETTINGS_KEY, Object.assign(defaultSettings(), settings, { schemaVersion: 2 }));
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
    wx.removeStorageSync(mode === 'practice' ? PRACTICE_SESSION_KEY : SESSION_KEY);
  } catch (error) {
    // A failed cleanup must not discard completed review records.
  }
}

function appendReview(state, review) {
  state.recentReviews = (state.recentReviews || []).concat(review).slice(-3000);
}

function getTodaySummary(state, now) {
  return state.daily[dayKey(now)] || null;
}

module.exports = {
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
