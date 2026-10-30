const store = require('./store');
const ledger = require('./time-ledger');
const IDLE_MS = 180000;
let active = null, timer = null, lastTouch = 0, serial = 0;
const listeners = new Set();
const run = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
function blocked() { return require('./cloud-sync').blocked(); }
function stopTimer() { if (timer) clearInterval(timer); timer = null; }
function initialize(daily, day) {
  if (daily.time) return;
  const session = store.getSession();
  const seconds = session && session.day === day ? session.elapsedSeconds || 0 : 0;
  daily.time = { version: 1, legacySeconds: Math.max((daily.minutes || 0) * 60, seconds), segments: {} };
}
function capture(now = Date.now()) {
  if (!active) return;
  if (blocked()) { active = null; stopTimer(); return; }
  const end = Math.min(now, lastTouch + IDLE_MS);
  if (end - active.cursor >= 1000) {
    const state = store.getState();
    let cursor = active.cursor;
    while (cursor < end) {
      const day = ledger.dayKey(cursor), dayEnd = ledger.bounds(day)[1];
      const finish = Math.min(end, dayEnd);
      const daily = state.daily[day] || (state.daily[day] = {});
      initialize(daily, day);
      const id = run + '-' + active.serial + '-' + day;
      const old = daily.time.segments[id];
      daily.time.segments[id] = { start: old ? old.start : cursor, end: finish, phase: active.phase };
      daily.minutes = Math.floor(ledger.summary(daily, day).seconds / 60);
      cursor = finish;
    }
    // Only advance the durable cursor after the local write succeeds.
    store.saveState(state);
    active.cursor = end;
    const day = ledger.dayKey(now);
    listeners.forEach(listener => listener(ledger.summary(state.daily[day] || {}, day)));
  }
  if (now >= lastTouch + IDLE_MS) { active = null; stopTimer(); }
}
function tick() { try { capture(); } catch (error) { if (Date.now() >= lastTouch + IDLE_MS) stopTimer(); } }
function enter(phase, now = Date.now(), owner = 'study') {
  if (!ledger.PHASES.includes(phase) || blocked()) return;
  if (active && active.phase === phase && active.owner === owner && now < lastTouch + IDLE_MS) { lastTouch = now; return; }
  // A timing checkpoint must not interrupt an already saved answer or leave
  // its old card on screen. Keep the cursor available for the next checkpoint.
  try { capture(now); } catch (error) { return; }
  if (!active || active.phase !== phase || active.owner !== owner) active = { phase, owner, cursor: now, serial: ++serial };
  lastTouch = now;
  if (!timer) { timer = setInterval(tick, 30000); if (timer && timer.unref) timer.unref(); }
}
function touch(phase, owner = 'study') { enter(phase || active && active.phase || 'detail', Date.now(), owner); }
function pause(owner) { if (owner && active && active.owner !== owner) return; try { capture(); } catch (error) { /* Learning records remain independently saved. */ } finally { active = null; stopTimer(); } }
function status() { return { active: Boolean(active), phase: active && active.phase, idleMs: IDLE_MS }; }
module.exports = { enter, touch, capture, pause, status, IDLE_MS,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
