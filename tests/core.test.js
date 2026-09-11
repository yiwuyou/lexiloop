const assert = require('assert');

const contextQuestions = require('../data/context-questions');
const vocabulary = require('../data/vocabulary');
const dates = require('../utils/date');
const scheduler = require('../utils/scheduler');
const studyPlan = require('../utils/study-plan');
const migrations = require('../utils/migrations');
const enrichment = require('../data/enrichment');

function testVocabulary() {
  assert.strictEqual(vocabulary.length, 2522, 'complete source record count');
  const ids = vocabulary.map((row) => `${row[0]}-${row[1]}-${row[2]}`);
  assert.strictEqual(new Set(ids).size, 2522, 'source ids must be unique');
  assert.strictEqual(vocabulary.filter((row) => row[0] === 'c').length, 436);
  assert.strictEqual(vocabulary.filter((row) => row[0] === 'h').length, 2086);
  assert.strictEqual(vocabulary.filter((row) => row[0] === 'h' && row[1] === 32 && row[2] === 19).length, 0);
  vocabulary.forEach((row) => {
    assert.ok(row[3] && row[4], `word and meaning required for ${row.slice(0, 3).join('-')}`);
  });
}

function testScheduler() {
  const now = Date.UTC(2026, 8, 3, 0, 0, 0);
  const good = scheduler.review(null, 'good', now);
  assert.strictEqual(good.seen, true);
  assert.strictEqual(good.interval, 3);
  assert.strictEqual(good.dueAt, now + 3 * dates.DAY_MS);

  const forgotten = scheduler.review(good, 'again', now + dates.DAY_MS);
  assert.strictEqual(forgotten.interval, 0);
  assert.strictEqual(forgotten.lapses, 1);
  assert.strictEqual(forgotten.dueAt, now + dates.DAY_MS + 10 * 60 * 1000);

  const easy = scheduler.review(null, 'easy', now);
  assert.strictEqual(easy.interval, 7);
  assert.ok(easy.dueAt > good.dueAt);
}

function testDailyPlan() {
  const state = { cards: {}, daily: {}, recentReviews: [] };
  const settings = { dailyNewCount: 50, examDate: '2026-12-15' };
  const now = new Date(2026, 8, 3, 9, 0, 0).getTime();
  const session = studyPlan.buildSession(state, settings, now);
  assert.strictEqual(session.newGoal, 50);
  assert.strictEqual(session.dueGoal, 0);
  assert.strictEqual(session.queue.filter((item) => item.phase === 'new').length, 50);
  assert.ok(session.queue.some((item) => item.phase === 'context'), 'first day should include delayed context checks');
  const nextDaySession = studyPlan.buildSession(state, settings, now + dates.DAY_MS);
  const todayQuestions = session.queue.filter((item) => item.phase === 'context').map((item) => item.questionId);
  const nextDayQuestions = nextDaySession.queue.filter((item) => item.phase === 'context').map((item) => item.questionId);
  assert.ok(todayQuestions.every((id) => !nextDayQuestions.includes(id)),
    'words with multiple context questions should rotate to a new sentence on the next day');

  const firstId = session.queue[0].wordId;
  state.cards[firstId] = scheduler.review(null, 'hard', now - 2 * dates.DAY_MS);
  state.cards[firstId].dueAt = now - dates.DAY_MS;
  const summary = studyPlan.summarize(state, settings, now);
  assert.strictEqual(summary.due.length, 1);
  assert.strictEqual(summary.overdue.length, 1);
}

function testContextQuestions() {
  assert.ok(contextQuestions.length >= 72, 'context question pool should not repeat a tiny fixed set');
  assert.strictEqual(new Set(contextQuestions.map((question) => question.id)).size, contextQuestions.length,
    'context question ids must be unique');
  contextQuestions.forEach((question) => {
    assert.ok(question.choices.length >= 2);
    assert.ok(question.answer >= 0 && question.answer < question.choices.length);
    assert.ok(question.translation && question.explanation);
  });
  const questionsPerWord = {};
  contextQuestions.forEach((question) => {
    const key = question.word.toLowerCase();
    questionsPerWord[key] = (questionsPerWord[key] || 0) + 1;
  });
  assert.ok(Object.values(questionsPerWord).every((count) => count >= 2),
    'every tested word should rotate between at least two sentences');
  const coreDayByWord = {};
  vocabulary.filter((row) => row[0] === 'c').forEach((row) => { coreDayByWord[row[3].toLowerCase()] = row[1]; });
  for (let day = 1; day <= 9; day += 1) {
    const covered = new Set(contextQuestions
      .filter((question) => coreDayByWord[question.word.toLowerCase()] === day)
      .map((question) => question.word.toLowerCase()));
    assert.ok(covered.size >= 3, `core day ${day} should contribute varied context words`);
  }
}

function testEnrichment() {
  assert.strictEqual(Object.keys(enrichment).length, 50, 'pilot must contain the first 50 real words');
  for (let index = 1; index <= 50; index += 1) {
    const item = enrichment[`c-1-${index}`];
    assert.ok(item && item.ipa && item.core && item.cue, `missing enrichment for c-1-${index}`);
  }
}

function testMigration() {
  const old = {
    version: 1,
    createdAt: 123,
    cards: { 'c-1-1': { seen: true, interval: 3 } },
    daily: { '2026-09-04': { newGoal: 50, newDone: 50 } },
    recentReviews: [{ wordId: 'c-1-1' }],
  };
  const migrated = migrations.migrateState(old);
  assert.strictEqual(migrated.schemaVersion, 3);
  assert.strictEqual(migrated.cards['c-1-1'].interval, 3);
  assert.strictEqual(migrated.daily['2026-09-04'].newDone, 50);
  assert.strictEqual(migrated.daily['2026-09-04'].extraNew, 0);
  assert.deepStrictEqual(migrated.weakBook, {});
  const backup = migrations.migrateBackup({ type: 'mem-vocab-backup', version: 1, state: old });
  assert.strictEqual(backup.state.schemaVersion, 3, 'v1 backup should remain importable');

  const v2 = {
    schemaVersion: 2,
    createdAt: 456,
    cards: {
      'c-1-1': { seen: true, lapses: 2, lastGrade: 'hard', interval: 1, lastAt: 789 },
      'c-1-2': { seen: true, lapses: 0, lastGrade: 'good', interval: 3, lastAt: 790 },
    },
    daily: {},
    recentReviews: [],
  };
  const migratedV2 = migrations.migrateState(v2);
  assert.deepStrictEqual(migratedV2.weakBook['c-1-1'], { addedAt: 789, source: 'migration' });
  assert.strictEqual(migratedV2.weakBook['c-1-2'], undefined);
}

function testExtraPlan() {
  const now = new Date(2026, 8, 5, 9, 0, 0).getTime();
  const state = { schemaVersion: 3, cards: {}, daily: {}, weakBook: {}, recentReviews: [] };
  for (let index = 1; index <= 50; index += 1) {
    state.cards[`c-1-${index}`] = scheduler.review(null, 'good', now);
  }
  state.daily['2026-09-05'] = { newGoal: 50, newDone: 50, completedAt: now };
  const settings = { dailyNewCount: 50, dailyMaxNewCount: 100, extraStep: 25 };
  const firstExtra = studyPlan.buildExtraSession(state, settings, 25, now);
  assert.strictEqual(firstExtra.newGoal, 75);
  assert.strictEqual(firstExtra.queue.filter((item) => item.phase === 'new').length, 25);
  assert.strictEqual(firstExtra.queue.find((item) => item.phase === 'new').wordId, 'c-2-1');

  firstExtra.queue.filter((item) => item.phase === 'new').forEach((item) => {
    state.cards[item.wordId] = scheduler.review(null, 'good', now);
  });
  state.daily['2026-09-05'] = { newGoal: 75, newDone: 75, extraNew: 25, completedAt: now };
  const secondExtra = studyPlan.buildExtraSession(state, settings, 50, now);
  assert.strictEqual(secondExtra.newGoal, 100, 'daily maximum must cap the second extra batch');
  assert.strictEqual(secondExtra.queue.filter((item) => item.phase === 'new').length, 25);
}

testVocabulary();
testScheduler();
testDailyPlan();
testContextQuestions();
testEnrichment();
testMigration();
testExtraPlan();
console.log('All core tests passed.');
