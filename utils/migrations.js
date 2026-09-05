const CURRENT_STATE_SCHEMA = 2;
const CURRENT_BACKUP_FORMAT = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRatings(ratings) {
  return Object.assign({ again: 0, hard: 0, good: 0, easy: 0 }, ratings || {});
}

function migrateV1ToV2(source) {
  const state = clone(source);
  state.schemaVersion = 2;
  delete state.version;
  state.cards = state.cards || {};
  state.daily = state.daily || {};
  state.recentReviews = state.recentReviews || [];
  Object.keys(state.daily).forEach((key) => {
    const day = state.daily[key] || {};
    day.ratings = normalizeRatings(day.ratings);
    day.completedAt = day.completedAt || 0;
    day.extraNew = day.extraNew || 0;
    state.daily[key] = day;
  });
  return state;
}

function stateVersion(state) {
  if (!state || typeof state !== 'object') return 0;
  return Number(state.schemaVersion || state.version || 1);
}

function validateState(state) {
  return Boolean(
    state
    && state.schemaVersion === CURRENT_STATE_SCHEMA
    && state.cards && typeof state.cards === 'object'
    && state.daily && typeof state.daily === 'object'
    && Array.isArray(state.recentReviews)
  );
}

function migrateState(source) {
  if (!source || typeof source !== 'object') return null;
  let state = clone(source);
  let version = stateVersion(state);
  if (version > CURRENT_STATE_SCHEMA) {
    throw new Error('backup-from-newer-version');
  }
  if (version === 1) {
    state = migrateV1ToV2(state);
    version = 2;
  }
  if (version !== CURRENT_STATE_SCHEMA || !validateState(state)) {
    throw new Error('invalid-state');
  }
  return state;
}

function migrateBackup(payload) {
  if (!payload || payload.type !== 'mem-vocab-backup' || !payload.state) {
    throw new Error('invalid-backup');
  }
  const formatVersion = Number(payload.formatVersion || payload.version || 1);
  if (formatVersion > CURRENT_BACKUP_FORMAT) {
    throw new Error('backup-from-newer-version');
  }
  return {
    state: migrateState(payload.state),
    settings: Object.assign({
      schemaVersion: 2,
      dailyNewCount: 50,
      dailyMaxNewCount: 100,
      extraStep: 25,
      examDate: '2026-12-15',
    }, payload.settings || {}, { schemaVersion: 2 }),
  };
}

module.exports = {
  CURRENT_BACKUP_FORMAT,
  CURRENT_STATE_SCHEMA,
  migrateBackup,
  migrateState,
  validateState,
};
