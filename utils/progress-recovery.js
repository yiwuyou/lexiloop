const { getWords } = require('./words');
const { initialState } = require('./scheduler');
const { DAY_MS, startOfDay } = require('./date');

const REVIEW_BATCH = 50;

function checkpoints() {
  const groups = [];
  getWords().forEach((word) => {
    let group = groups[groups.length - 1];
    if (!group || group.category !== word.category || group.day !== word.day) {
      group = { category: word.category, day: word.day, label: `${word.category === 'core' ? '核心' : '高频'} day ${word.day}`, words: [] };
      groups.push(group);
    }
    group.words.push(word);
  });
  return groups;
}

function selectedWords(groupIndex, count) {
  const groups = checkpoints();
  if (!Number.isInteger(groupIndex) || !groups[groupIndex]
    || !Number.isInteger(count) || count < 0 || count > groups[groupIndex].words.length) {
    throw new Error('invalid-checkpoint');
  }
  return groups.slice(0, groupIndex).reduce((all, group) => all.concat(group.words), [])
    .concat(groups[groupIndex].words.slice(0, count));
}

function preview(state, groupIndex, count) {
  const words = selectedWords(groupIndex, count);
  const missing = words.filter((word) => !(state.cards[word.id] || {}).seen);
  return { total: words.length, added: missing.length, days: Math.ceil(missing.length / REVIEW_BATCH) };
}

function recover(state, groupIndex, count, now) {
  const time = now || Date.now();
  const next = JSON.parse(JSON.stringify(state));
  const missing = selectedWords(groupIndex, count).filter((word) => !(next.cards[word.id] || {}).seen);
  // Spread the recovered range across dates, mixing source neighbours without
  // claiming that any previous answer, review date or mastery level is known.
  let seed = 9157;
  for (let index = missing.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [missing[index], missing[target]] = [missing[target], missing[index]];
  }
  missing.forEach((word, index) => {
    next.cards[word.id] = Object.assign(initialState(), {
      seen: true,
      dueAt: startOfDay(time) + Math.floor(index / REVIEW_BATCH) * DAY_MS,
      recoveredAt: time,
    });
  });
  if (missing.length) {
    const group = checkpoints()[groupIndex];
    next.progressRecovery = { at: time, category: group.category, day: group.day, count, added: missing.length };
  }
  return next;
}

module.exports = { checkpoints, preview, recover, REVIEW_BATCH };
