// Shared, platform-independent synchronization protocol. Server build copies
// this file verbatim; no credentials or device APIs belong in this module.
const VERSION = 3;
const timeLedger = require('./time-ledger');
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
  const add = (path, left, right) => { if (JSON.stringify(left) !== JSON.stringify(right) && !equal(left, right)) changes.push({ path, before: left == null ? null : left, after: right == null ? null : right }); };
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
const dayMaps = ['taskPlan', 'firstAnswers', 'firstOverdue', 'taskStatus', 'carryTasks', 'ratings', 'firstAnswerOffset'];
const taskRoot = path => ['session', 'practiceSession'].includes(path[0]);
function fingerprint(value) {
  const text = stable(value); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function fineChanges(changes) {
  const result = [];
  const add = (path, before, after) => { if (!equal(before, after)) result.push({ path, before: before == null ? null : before, after: after == null ? null : after }); };
  const entries = (path, before = {}, after = {}) => {
    for (const key of new Set(Object.keys(before || {}).concat(Object.keys(after || {})))) add(path.concat(key), before && before[key], after && after[key]);
  };
  for (const change of changes) {
    const path = change.path, before = change.before, after = change.after;
    if (path.length === 3 && path[1] === 'daily' && after) {
      for (const key of new Set(Object.keys(before || {}).concat(Object.keys(after)))) {
        const left = before && before[key], right = after[key], field = path.concat(key);
        if (dayMaps.includes(key) && right) entries(field, left, right);
        else if (key === 'time' && right) {
          add(field.concat('version'), left && left.version, right.version);
          add(field.concat('legacySeconds'), left && left.legacySeconds, right.legacySeconds);
          entries(field.concat('segments'), left && left.segments, right.segments);
        } else add(field, left, right);
      }
    } else if (path.length === 1 && taskRoot(path) && before && after && before.day === after.day && before.startedAt === after.startedAt) {
      for (const key of new Set(Object.keys(before).concat(Object.keys(after)))) {
        const left = before[key], right = after[key], field = path.concat(key);
        if (equal(left, right)) continue;
        if (key === 'queue' && Array.isArray(left) && Array.isArray(right)) {
          let start = 0, tail = 0;
          while (start < Math.min(left.length, right.length) && equal(left[start], right[start])) start++;
          while (tail < Math.min(left.length, right.length) - start && equal(left[left.length - 1 - tail], right[right.length - 1 - tail])) tail++;
          result.push({ path: field, splice: { start, remove: left.length - start - tail, items: right.slice(start, right.length - tail), before: fingerprint(left), after: fingerprint(right), length: left.length } });
        } else if (['taskPlan', 'ratings'].includes(key) && right) entries(field, left, right);
        else add(field, left, right);
      }
    } else result.push(change);
  }
  return result;
}
const fineDiff = (before, after) => fineChanges(diff(before, after));
function allowed(path) {
  if (!Array.isArray(path) || path.some(key => typeof key !== 'string' || dangerous(key))) return false;
  if (path.length === 1) return ['session', 'practiceSession'].includes(path[0]);
  if (taskRoot(path)) return path.length === 2 || path.length === 3 && ['taskPlan', 'ratings'].includes(path[1]);
  if (path[0] === 'state' && path[1] === 'daily' && path[2] && path[2].length <= 2000) {
    if (path.length === 4) return true;
    if (path.length === 5) return dayMaps.includes(path[3]) || path[3] === 'time' && ['version', 'legacySeconds'].includes(path[4]);
    if (path.length === 6) return path[3] === 'time' && path[4] === 'segments';
  }
  if (path.length === 2) return path[0] === 'settings'
    ? ['schemaVersion', 'dailyNewCount', 'dailyMaxNewCount', 'dailyReviewLimit', 'reviewLimitVersion', 'dailyBacklogLimit', 'extraStep', 'examDate', 'learningDeadline', 'examPlanVersion'].includes(path[1])
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
  if ((current.fsrs || incoming.fsrs) && !equal(current, incoming)) {
    // Conflicting device models cannot be averaged into a fictitious memory.
    // Preserve both histories and re-enter FSRS at the next actual answer.
    merged.fsrs = null; merged.fsrsNeedsRecheck = true;
  }
  const dates = [current.dueAt, incoming.dueAt].filter(value => Number.isFinite(value));
  merged.dueAt = dates.length ? Math.min(...dates) : 0;
  merged.interval = Math.min(current.interval || 0, incoming.interval || 0);
  merged.ease = Math.min(current.ease || 2.4, incoming.ease || 2.4);
  merged.reps = Math.max(current.reps || 0, incoming.reps || 0);
  merged.lapses = Math.max(current.lapses || 0, incoming.lapses || 0);
  merged.lastAt = Math.max(current.lastAt || 0, incoming.lastAt || 0);
  merged.needsRecall = Boolean(merged.fsrsNeedsRecheck || current.needsRecall || incoming.needsRecall);
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
  return mergeLearningDaily(current, result);
}
function mergeLearningDaily(current = {}, incoming = {}) {
  const result = Object.assign({}, incoming);
  for (const key of ['taskPlan', 'firstAnswers', 'firstOverdue']) {
    if (current[key] || incoming[key]) result[key] = Object.assign({}, current[key], incoming[key]);
    Object.keys(result[key] || {}).forEach(id => {
      if (current[key] && current[key][id] === 'new' || incoming[key] && incoming[key][id] === 'new') result[key][id] = 'new';
    });
  }
  if (current.taskStatus || incoming.taskStatus) {
    result.taskStatus = Object.assign({}, current.taskStatus);
    Object.entries(incoming.taskStatus || {}).forEach(([id, value]) => {
      const old = result.taskStatus[id];
      if (!old || value.at > old.at || (value.at === old.at && !value.passed)) result.taskStatus[id] = value;
    });
  }
  if (current.initialEstimate && (!incoming.initialEstimate || current.initialEstimate.at < incoming.initialEstimate.at)) result.initialEstimate = current.initialEstimate;
  if (current.carryTasks || incoming.carryTasks) {
    result.carryTasks = Object.assign({}, current.carryTasks);
    Object.entries(incoming.carryTasks || {}).forEach(([id, value]) => {
      const old = result.carryTasks[id];
      if (!old || value.at > old.at || value.at === old.at && !value.item) result.carryTasks[id] = value;
    });
  }
  if (current.time || incoming.time) result.time = timeLedger.merge(current.time, incoming.time);
  if (current.firstAnswerOffset || incoming.firstAnswerOffset) {
    result.firstAnswerOffset = {
      review: Math.max(current.firstAnswerOffset && current.firstAnswerOffset.review || 0, incoming.firstAnswerOffset && incoming.firstAnswerOffset.review || 0),
      new: Math.max(current.firstAnswerOffset && current.firstAnswerOffset.new || 0, incoming.firstAnswerOffset && incoming.firstAnswerOffset.new || 0),
      backlog: Math.max(current.firstAnswerOffset && current.firstAnswerOffset.backlog || 0, incoming.firstAnswerOffset && incoming.firstAnswerOffset.backlog || 0),
    };
  }
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
  // A queue splice must match its base. Reject the whole task image on a
  // mismatch, but still retain independent real answers and card changes.
  const rejectedTasks = new Set();
  for (const change of event.changes) if (change.splice) {
    const path = change.path, patch = change.splice;
    if (!allowed(path) || path.length !== 2 || !taskRoot(path) || path[1] !== 'queue'
      || !Number.isInteger(patch.start) || !Number.isInteger(patch.remove) || !Number.isInteger(patch.length)
      || patch.start < 0 || patch.remove < 0 || patch.start + patch.remove > patch.length || !Array.isArray(patch.items) || patch.items.length > 12000
      || !/^[a-f0-9]{1,8}$/.test(patch.before || '') || !/^[a-f0-9]{1,8}$/.test(patch.after || '')) throw new Error('invalid-queue-patch');
    const current = bundle[path[0]] && bundle[path[0]].queue;
    if (!Array.isArray(current) || fingerprint(current) !== patch.after && (current.length !== patch.length || fingerprint(current) !== patch.before)) rejectedTasks.add(path[0]);
  }
  event.changes.forEach(change => {
    const path = change.path;
    if (!allowed(path)) throw new Error('invalid-path');
    if (taskRoot(path) && (rejectedTasks.has(path[0]) || context.owner && (context.owner.device !== event.device || context.owner.epoch !== event.epoch))) { conflicts++; return; }
    let parent = bundle;
    path.slice(0, -1).forEach(key => { if (!parent[key]) parent[key] = {}; parent = parent[key]; });
    const key = path[path.length - 1], current = parent[key];
    if (change.splice) {
      if (fingerprint(current) !== change.splice.after) {
        const next = current.slice(); next.splice(change.splice.start, change.splice.remove, ...change.splice.items);
        if (fingerprint(next) !== change.splice.after) throw new Error('queue-patch-checksum');
        parent[key] = next;
      }
      return;
    }
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
    if (path[1] === 'daily' && path.length >= 4) {
      const field = path[3];
      if (path.length === 6 && value && current) value = value.end > current.end ? value : current;
      else if (path.length === 5 && ['taskStatus', 'carryTasks'].includes(field) && current && value) {
        if (current.at > value.at || current.at === value.at && (field === 'taskStatus' ? !current.passed : !current.item)) value = current;
      } else if (path.length === 5 && ['taskPlan', 'firstAnswers', 'firstOverdue'].includes(field) && (current === 'new' || value === 'new')) value = 'new';
      else if (field === 'initialEstimate' && current && (!value || current.at < value.at)) value = current;
      else if ((field === 'time' && path[4] === 'legacySeconds' || field === 'firstAnswerOffset') && value != null) value = Math.max(current || 0, value);
      else if (!equal(current, change.before) && ['dueDone', 'newDone', 'backlogDone', 'dueGoal', 'newGoal', 'reinforcementDone', 'contextDone', 'contextCorrect', 'sentenceDone', 'sentenceCorrect', 'minutes', 'extraNew'].includes(field)) value = Math.max(current || 0, value || 0);
      if (value == null) delete parent[key]; else parent[key] = clone(value);
      return;
    }
    if (!equal(current, change.before) && !equal(current, value)) {
      conflicts++;
      if (path[1] === 'cards') value = conservativeCard(current, value);
      else if (path[1] === 'daily' || path[1] === 'practice') value = mergeDaily(current, value);
      else if (path[0] === 'settings') value = current; // Do not roll back a newer online setting.
    }
    if (value == null) delete parent[key];
    else parent[key] = clone(path[1] === 'daily' ? mergeLearningDaily(current, value) : value);
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
// Authoritative server delta, followed by replay of still-unacknowledged local
// events. Do not run conflict resolution twice on already-resolved values.
function overlay(bundle, changes) {
  changes.forEach(change => {
    if (!allowed(change.path)) throw new Error('invalid-path');
    let parent = bundle;
    change.path.slice(0, -1).forEach(key => { parent = parent[key] || (parent[key] = {}); });
    const key = change.path[change.path.length - 1];
    if (change.splice) {
      const patch = change.splice, current = parent[key];
      if (!Array.isArray(current)) throw new Error('queue-delta-base-mismatch');
      if (fingerprint(current) === patch.after) return;
      if (current.length !== patch.length || fingerprint(current) !== patch.before) throw new Error('queue-delta-base-mismatch');
      const next = current.slice(); next.splice(patch.start, patch.remove, ...patch.items);
      if (fingerprint(next) !== patch.after) throw new Error('queue-delta-checksum');
      parent[key] = next;
    } else if (change.append) parent[key] = unionReviews(parent[key] || [], change.append);
    else if (change.after == null) delete parent[key];
    else parent[key] = clone(change.after);
  });
  return bundle;
}
module.exports = { VERSION, clone, equal, valid, learned, diff, fineDiff, fineChanges, fingerprint, apply, attach, overlay };
