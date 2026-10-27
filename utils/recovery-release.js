const recovery = require('./progress-recovery');
const { dayKey } = require('./date');

// Explicitly requested personal recovery after the 2026-10-27 cache loss.
// This is a checkpoint, NOT a claim to have recovered any old answers.
const REPAIR_ID = '2026-10-27-high13-review100';
const BACKUP_KEY = 'mem_vocab_before_repair_20261027';

function prepare(state, now = Date.now()) {
  if (state.recoveryRelease === REPAIR_ID) return null;
  const index = recovery.checkpoints().findIndex(group => group.category === 'high' && group.day === 13);
  const next = recovery.recover(state, index, 0, now, { reviewAll: true });
  const today = next.daily[dayKey(now)];
  if (today) {
    // A pre-repair task is not evidence of having rechecked restored words.
    Object.assign(today, { dueDone: 0, dueGoal: 100, backlogDone: 0, completedAt: 0 });
  }
  next.recoveryRelease = REPAIR_ID;
  return next;
}

function run(store, now = Date.now()) {
  const state = store.getState();
  const next = prepare(state, now);
  if (!next) return false;
  const settings = store.getSettings();
  // Keep a local rollback snapshot before any write. It cannot survive a
  // subsequent cache clear and must never be presented as a cloud backup.
  if (!wx.getStorageSync(BACKUP_KEY)) {
    wx.setStorageSync(BACKUP_KEY, {
      at: now, state, settings,
      session: store.getSession(), practiceSession: store.getSession('practice'),
    });
  }
  store.saveSettings(Object.assign({}, settings, { dailyReviewLimit: 100, reviewLimitVersion: 1 }));
  store.clearSession();
  store.clearSession('practice');
  if (store.getSession() || store.getSession('practice')) throw new Error('cannot-clear-old-task');
  // Persist the one-time marker last. A failed write must remain retryable.
  store.saveState(next);
  return true;
}

module.exports = { prepare, run, REPAIR_ID, BACKUP_KEY };
