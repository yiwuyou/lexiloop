// Shared, platform-independent synchronization protocol. Server build copies
// this file verbatim; no credentials or device APIs belong in this module.
const VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const maps = ['cards', 'daily', 'weakBook', 'sentenceBook', 'practice'];
const dangerous = key => ['__proto__', 'prototype', 'constructor'].includes(key);
function stable(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const equal = (a, b) => stable(a) === stable(b);
function valid(bundle) {
  return !!(bundle && bundle.state && bundle.state.schemaVersion === 3
    && bundle.state.cards && bundle.state.daily && bundle.state.weakBook
    && Array.isArray(bundle.state.recentReviews) && bundle.settings && bundle.settings.schemaVersion === 2
    && ['session', 'practiceSession'].every(key => !bundle[key] || Array.isArray(bundle[key].queue)));
}
function learned(bundle) { return Object.values(bundle.state.cards).filter(card => card.seen).length; }
function reviewKey(entry) { return entry.id || stable(entry); }
function unionReviews(left, right) {
  const result = new Map();
  left.concat(right).forEach(entry => result.set(reviewKey(entry), entry));
  return Array.from(result.values()).sort((a, b) => a.at - b.at).slice(-3000);
}
function diff(before, after) {
  const changes = [];
  const add = (path, left, right) => { if (!equal(left, right)) changes.push({ path, before: left == null ? null : left, after: right == null ? null : right }); };
  maps.forEach(name => {
    const left = before.state[name] || {}, right = after.state[name] || {};
    Array.from(new Set(Object.keys(left).concat(Object.keys(right))))
      .forEach(key => add(['state', name, key], left[key], right[key]));
  });
  const known = new Set(before.state.recentReviews.map(reviewKey));
  const added = after.state.recentReviews.filter(entry => !known.has(reviewKey(entry)));
  if (added.length) changes.push({ path: ['state', 'recentReviews'], append: added });
  ['progressRecovery', 'recoveryRelease'].forEach(key => add(['state', key], before.state[key], after.state[key]));
  Object.keys(after.settings).forEach(key => add(['settings', key], before.settings[key], after.settings[key]));
  ['session', 'practiceSession'].forEach(key => add([key], before[key], after[key]));
  return changes;
}
function allowed(path) {
  if (!Array.isArray(path) || path.some(key => typeof key !== 'string' || dangerous(key))) return false;
  if (path.length === 1) return ['session', 'practiceSession'].includes(path[0]);
  if (path.length === 2) return path[0] === 'settings'
    ? ['schemaVersion', 'dailyNewCount', 'dailyMaxNewCount', 'dailyReviewLimit', 'reviewLimitVersion', 'dailyBacklogLimit', 'extraStep', 'examDate'].includes(path[1])
    : path[0] === 'state' && ['recentReviews', 'progressRecovery', 'recoveryRelease'].includes(path[1]);
  return path.length === 3 && path[0] === 'state' && maps.includes(path[1]) && path[2].length <= 2000;
}
function conservativeCard(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;
  // Restored placeholders must never erase an actual answer on another device.
  if (!incoming.reps && current.reps) return current;
  if (!current.reps && incoming.reps) return incoming;
  const merged = Object.assign({}, current, incoming);
  const dates = [current.dueAt, incoming.dueAt].filter(value => Number.isFinite(value));
  merged.dueAt = dates.length ? Math.min(...dates) : 0;
  merged.interval = Math.min(current.interval || 0, incoming.interval || 0);
  merged.ease = Math.min(current.ease || 2.4, incoming.ease || 2.4);
  merged.reps = Math.max(current.reps || 0, incoming.reps || 0);
  merged.lapses = Math.max(current.lapses || 0, incoming.lapses || 0);
  merged.lastAt = Math.max(current.lastAt || 0, incoming.lastAt || 0);
  merged.needsRecall = Boolean(current.needsRecall || incoming.needsRecall);
  merged.needsContext = current.needsContext || incoming.needsContext || '';
  merged.failedDay = [current.failedDay || '', incoming.failedDay || ''].sort().pop();
  if (merged.needsRecall) merged.lastGrade = 'hard';
  return merged;
}
function mergeDaily(current = {}, incoming = {}) {
  const result = Object.assign({}, current, incoming);
  ['dueDone', 'newDone', 'backlogDone', 'dueGoal', 'newGoal', 'reinforcementDone', 'contextDone', 'contextCorrect', 'sentenceDone', 'sentenceCorrect', 'minutes', 'extraNew']
    .forEach(key => { result[key] = Math.max(current[key] || 0, incoming[key] || 0); });
  result.completedAt = current.completedAt && incoming.completedAt ? Math.max(current.completedAt, incoming.completedAt) : 0;
  return result;
}
function deriveDaily(bundle) {
  const groups = {};
  bundle.state.recentReviews.forEach(entry => {
    if (!entry.day) return;
    const group = groups[entry.day] || (groups[entry.day] = { due: new Set(), new: new Set(), backlog: new Set() });
    if (entry.phase === 'review') { group.due.add(entry.wordId); if (entry.overdue) group.backlog.add(entry.wordId); }
    if (entry.phase === 'new') group.new.add(entry.wordId);
  });
  Object.entries(groups).forEach(([day, group]) => {
    const daily = bundle.state.daily[day];
    if (!daily) return;
    daily.dueDone = Math.max(daily.dueDone || 0, group.due.size);
    daily.newDone = Math.max(daily.newDone || 0, group.new.size);
    daily.backlogDone = Math.max(daily.backlogDone || 0, group.backlog.size);
  });
}
function apply(bundle, event, context = {}) {
  if (!Array.isArray(event.changes) || event.changes.length > 12000) throw new Error('invalid-changes');
  let conflicts = 0;
  event.changes.forEach(change => {
    const path = change.path;
    if (!allowed(path)) throw new Error('invalid-path');
    if (path.length === 1 && context.owner && (context.owner.device !== event.device || context.owner.epoch !== event.epoch)) return;
    let parent = bundle;
    path.slice(0, -1).forEach(key => { if (!parent[key]) parent[key] = {}; parent = parent[key]; });
    const key = path[path.length - 1], current = parent[key];
    if (path[1] === 'recentReviews') {
      if (!Array.isArray(change.append) || change.append.length > 3000) throw new Error('invalid-reviews');
      parent[key] = unionReviews(current || [], change.append);
      return;
    }
    const versionKey = JSON.stringify(path);
    const versions = context.versions || {};
    const version = versions[versionKey] || {};
    // A delayed add cannot resurrect a bookmark deleted after its base version.
    if (['weakBook', 'sentenceBook'].includes(path[1]) && current == null && change.after != null
      && (version.rev || 0) > (event.baseRev || 0)
      && !(version.device === event.device && event.seq > version.seq)) return;
    let value = change.after;
    if (!equal(current, change.before) && !equal(current, value)) {
      conflicts++;
      if (path[1] === 'cards') value = conservativeCard(current, value);
      else if (path[1] === 'daily' || path[1] === 'practice') value = mergeDaily(current, value);
      else if (path[0] === 'settings') value = current; // Do not roll back a newer online setting.
    }
    if (value == null) delete parent[key];
    else parent[key] = clone(value);
    versions[versionKey] = { rev: context.nextRev || 0, device: event.device, seq: event.seq };
  });
  deriveDaily(bundle);
  return conflicts;
}
function attach(remote, local) {
  const result = clone(remote);
  Object.entries(local.state.cards).forEach(([id, card]) => {
    result.state.cards[id] = result.state.cards[id] ? conservativeCard(result.state.cards[id], card) : card;
  });
  ['weakBook', 'sentenceBook'].forEach(key => { result.state[key] = Object.assign({}, local.state[key] || {}, result.state[key] || {}); });
  Object.entries(local.state.daily).forEach(([day, daily]) => { result.state.daily[day] = mergeDaily(result.state.daily[day], daily); });
  result.state.recentReviews = unionReviews(remote.state.recentReviews, local.state.recentReviews);
  deriveDaily(result);
  return result;
}
module.exports = { VERSION, clone, equal, valid, learned, diff, apply, attach };
