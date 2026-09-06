const assert = require('assert');
const fs = require('fs');
const path = require('path');
const clone = (value) => JSON.parse(JSON.stringify(value));
const memory = {};
global.wx = {
  getStorageSync: (key) => memory[key] ? clone(memory[key]) : '',
  setStorageSync: (key, value) => { memory[key] = clone(value); },
  removeStorageSync: (key) => { delete memory[key]; },
};
const { getWords } = require('../utils/words');
const practice = require('../utils/practice');
const store = require('../utils/store');
const scheduler = require('../utils/scheduler');
const plan = require('../utils/study-plan');
const migrations = require('../utils/migrations');
const words = getWords();
const now = new Date(2026, 8, 6, 10).getTime();
const state = { schemaVersion: 2, cards: {}, daily: {}, recentReviews: [] };
words.slice(0, 100).forEach((word) => { state.cards[word.id] = scheduler.review(null, 'hard', now); });
const before = clone(state);
const settings = { dailyNewCount: 50, examDate: '2026-12-15' };
const future = plan.buildSession(state, settings, now + 86400000);
const session = practice.buildSession(state, { category: 'core', day: 1 }, now);
assert.strictEqual(session.queue.length, 50);
assert.strictEqual(session.queue[0].wordId, 'c-1-1');
for (let index = 0; index < 50; index++) practice.recordAnswer(state, session, ['again', 'hard', 'good', 'easy'][index % 4], now);
assert.strictEqual(session.index, 50);
assert.strictEqual(practice.recordAnswer(state, session, 'good', now), false);
for (const key of ['cards', 'daily', 'recentReviews']) assert.deepStrictEqual(state[key], before[key], key + ' must not change');
assert.deepStrictEqual(plan.buildSession(state, settings, now + 86400000), future);
assert.strictEqual(practice.buildSession(state, {}, now).queue.length, 50);
assert.strictEqual(practice.buildSession(state, { category: 'high', day: 1 }, now).queue.length, 0);
assert.deepStrictEqual(migrations.migrateState(state).practice, state.practice);
store.saveState(state);
store.saveSession(future);
store.saveSession(session);
assert.deepStrictEqual(store.getSession(), future);
assert.deepStrictEqual(store.getSession('practice'), session);
store.clearSession('practice');
assert.strictEqual(store.getSession('practice'), null);
assert.deepStrictEqual(store.getSession(), future);
assert.deepStrictEqual(store.getState().cards, before.cards);
assert.strictEqual(new Set(words.map((word) => word.category + '-' + word.day)).size, 51);
let library;
global.Page = (definition) => { library = definition; };
wx.createInnerAudioContext = () => ({ onPlay() {}, onEnded() {}, onStop() {}, onError() {}, destroy() {} });
require('../pages/library/index');
library.data = clone(library.data);
library.setData = function (values, callback) { Object.assign(this.data, values); if (callback) callback(); };
library.onLoad();
assert.strictEqual(library.data.dayGroups.length, 51);
library.changeDay({ detail: { value: 2 } });
assert.strictEqual(library.data.resultCount, 50);
assert.strictEqual(library.data.visibleWords[0].id, 'c-2-1');
library.showDays();
assert.strictEqual(library.data.dayGroups.length, 51);
library.selectFilter({ currentTarget: { dataset: { filter: 'high' } } });
assert.strictEqual(library.data.dayGroups.length, 42);
library.changeDay({ detail: { value: 1 } });
assert.strictEqual(library.data.visibleWords[0].id, 'c-1-1', 'day selection clears conflicting category filter');
const app = require('../app.json');
app.subPackages.forEach((pack) => pack.pages.forEach((page) => {
  ['.js', '.json', '.wxml'].forEach((extension) => assert.ok(fs.existsSync(path.join(__dirname, '..', pack.root, page + extension))));
}));
const paths = new Set();
const packageSizes = {};
words.forEach((word) => {
  assert.ok(word.example && word.translation && word.exampleCredit && word.ipa && word.audio, word.id);
  assert.ok(word.audio.startsWith('/' + word.audioPackage + '/'));
  paths.add(word.audio);
});
if (!process.argv.includes('--skip-audio')) paths.forEach((audio) => {
  const size = fs.statSync(path.join(__dirname, '..', audio)).size;
  assert.ok(size > 500, audio);
  const name = audio.split('/')[1];
  packageSizes[name] = (packageSizes[name] || 0) + size;
});
Object.entries(packageSizes).forEach(([name, size]) => assert.ok(size < 2 * 1024 * 1024 - 4096, name + ' exceeds package budget: ' + size));
console.log('Practice isolation, session persistence, migration, 51 days, 2522 content records passed.', { audioFiles: paths.size, packageSizes });

async function testAudio() {
  let calls = 0;
  let fail = true;
  wx.loadSubpackage = ({ success, fail: failure }) => {
    calls++;
    setTimeout(() => fail ? failure(new Error('offline')) : success(), 0);
  };
  const audio = require('../utils/audio');
  await assert.rejects(audio.sourceFor(words[0]));
  fail = false;
  const result = await Promise.all([audio.sourceFor(words[0]), audio.sourceFor(words[1])]);
  assert.strictEqual(calls, 2, 'concurrent requests share one package load; failure is retryable');
  assert.strictEqual(result[0], words[0].audio);
  await audio.sourceFor(words[0]);
  assert.strictEqual(calls, 2, 'loaded package is reused');
  let progress = 0;
  await audio.downloadAll((count) => { progress = count; });
  assert.strictEqual(progress, 12);
  assert.strictEqual(calls, 13);
  console.log('Audio lazy load, retries, deduplication and full download passed.');
}
testAudio().catch((error) => { console.error(error); process.exitCode = 1; });
