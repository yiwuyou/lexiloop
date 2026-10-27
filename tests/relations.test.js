const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getWords, getWord } = require('../utils/words');
const engine = require('../utils/relations-engine');
const relationData = require('../relation-data/ready');

const clone = value => JSON.parse(JSON.stringify(value));
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const words = getWords();
const heads = new Map();
words.forEach(word => {
  const head = engine.headOf(word);
  const records = heads.get(head) || [];
  records.push(word);
  heads.set(head, records);
});
const state = { schemaVersion: 3, cards: {}, daily: {}, weakBook: {}, recentReviews: [] };
const idFor = head => heads.get(head)[0].id;

function evaluate(file, requireMock, additions = {}) {
  const module = { exports: {} };
  vm.runInNewContext(source(file), Object.assign({ module, exports: module.exports, require: requireMock, console }, additions), { filename: file });
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

function testCorpus() {
  assert.strictEqual(words.length, 2522, 'test the whole institution word bank, not just core days');
  assert.strictEqual(heads.size, 2514);
  assert.strictEqual(Object.keys(relationData.common).length, heads.size);
  const corrected = { aural: '听觉', viable: '可行', underlying: '根本', render: '使成为', venue: '场所', sibling: '姐妹', approach: '方法', account: '账户', power: '电力', volume: '音量', sense: '意义', script: '剧本', rest: '其余', workout: '锻炼' };
  Object.entries(corrected).forEach(([head, meaning]) => assert.ok(relationData.common[head].includes(meaning), head + ' must include its ordinary key sense'));
  for (const [head, bad] of [['economic', '节省'], ['sensible', '敏感'], ['voluntary', '自动'], ['foster', '福斯特'], ['aid', '艾滋'], ['mute', '排泄'], ['evolution', '开方']]) {
    assert.ok(!relationData.common[head].includes(bad), head + ' has an inappropriate everyday gloss');
  }
  for (const head of heads.keys()) {
    assert.ok(relationData.common[head] && /[\u3400-\u9fff]/.test(relationData.common[head]), head + ' needs Chinese common meanings');
    assert.ok(!/暂无可靠|待补充|未找到/.test(relationData.common[head]), head + ' must not silently use a missing-definition placeholder');
  }
  Object.entries(relationData.synonyms).forEach(([head, links]) => {
    assert.ok(heads.has(head), 'semantic source must be in institution bank: ' + head);
    assert.strictEqual(new Set(links.map(link => link.word)).size, links.length, head + ' duplicate semantic candidates');
    links.forEach(link => {
      assert.ok(heads.has(link.word), head + ' semantic candidate outside bank: ' + link.word);
      assert.notStrictEqual(link.word, head);
      assert.ok(link.sense && /[\u3400-\u9fff]/.test(link.sense), head + ' needs a specific shared Chinese sense');
    });
  });

  const snapshot = JSON.stringify(state);
  const results = new Map();
  for (const word of words) {
    const result = engine.build(word.id, relationData, state);
    assert.ok(result, word.id);
    assert.strictEqual(result.target.id, idFor(engine.headOf(word)));
    assert.strictEqual(result.target.meaning, word.meaning, 'active card institution meaning must remain exact: ' + word.id);
    assert.strictEqual(result.target.common, relationData.common[engine.headOf(word)]);
    assert.strictEqual(new Set(result.semantic.map(item => item.head)).size, result.semantic.length);
    assert.strictEqual(new Set(result.shapes.map(item => item.head)).size, result.shapes.length);
    [...result.semantic, ...result.shapes].forEach(candidate => {
      assert.ok(heads.has(candidate.head), word.id + ': candidate must belong to bank');
      assert.ok(getWord(candidate.id));
      const meanings = [...new Set(heads.get(candidate.head).map(record => record.meaning))];
      assert.strictEqual(candidate.meaning, meanings.join('；'), candidate.head + ': exact institution meanings, deduplicated by spelling');
      assert.strictEqual(candidate.common, relationData.common[candidate.head]);
      assert.notStrictEqual(candidate.head, engine.headOf(word));
    });
    result.shapes.forEach(candidate => {
      assert.strictEqual(candidate.parts.map(part => part.text).join(''), candidate.head, 'highlight must reconstruct the full candidate');
      assert.strictEqual(candidate.targetParts.map(part => part.text).join(''), engine.headOf(word), 'highlight must reconstruct the full target');
      assert.strictEqual(candidate.parts.filter(part => part.shared).map(part => part.text).join(''), candidate.shared);
      assert.strictEqual(candidate.targetParts.filter(part => part.shared).map(part => part.text).join(''), candidate.shared);
    });
    if (!results.has(engine.headOf(word))) results.set(engine.headOf(word), result);
  }
  assert.strictEqual(JSON.stringify(state), snapshot, 'viewing all relations must not alter study history or schedules');
  assert.strictEqual(engine.build('missing-id', relationData, state), null);
  for (const [left, right] of [['deliberate', 'liberate'], ['liberate', 'deliberate']]) {
    const result = results.get(left);
    const link = result.shapes.find(item => item.head === right);
    assert.ok(link, left + ' ↔ ' + right + ' must be a spelling association');
    assert.strictEqual(link.shared, 'liberate');
    assert.ok(link.note.includes('不') && link.note.includes('同义'), 'do not present spelling similarity as synonymy');
    assert.ok(!result.semantic.some(item => item.head === right), 'deliberate and liberate are not synonyms');
  }
  for (const [left, right] of [['confident', 'confidential'], ['adapt', 'adopt'], ['effect', 'affect'], ['explicit', 'implicit'], ['converge', 'diverge'], ['economic', 'economical'], ['form', 'from'], ['desert', 'dessert']]) {
    if (!results.has(left) || !results.has(right)) continue;
    assert.ok(!results.get(left).semantic.some(item => item.head === right), left + ' / ' + right + ': spelling similarity must not invent a semantic link');
    assert.ok(!results.get(right).semantic.some(item => item.head === left), right + ' / ' + left + ': spelling similarity must not invent a semantic link');
  }
  assert.ok(!results.get('nation').shapes.some(item => item.head === 'action'), 'sharing only -tion must not create an unrelated spelling link');
  assert.ok(!results.get('relation').shapes.some(item => item.head === 'education'), 'sharing only -ation must not create an unrelated spelling link');
  assert.ok(!results.get('deliberate').shapes.some(item => item.head === 'operate'), 'sharing only -erate is a weak memorization bridge');
  assert.ok(!results.get('foster').shapes.some(item => item.head === 'master'), 'sharing only -ster is not enough to make a useful comparison');
  assert.ok(!results.get('action').shapes.some(item => item.head === 'vacation'), 'editing two letters must not bypass the bare suffix filter');
  assert.ok(results.get('nation').shapes.some(item => item.head === 'notion'), 'a one-letter spelling contrast remains useful despite its suffix');
  assert.ok(results.get('migrate').shapes.some(item => item.head === 'emigrate'), 'known migration pair should be discoverable');
  const learnedState = clone(state);
  learnedState.cards[idFor('ponder')] = { seen: true };
  const learnedResult = engine.build(idFor('deliberate'), relationData, learnedState);
  assert.strictEqual(learnedResult.semantic[0].head, 'ponder', 'prefer already learned comparison words');
  console.log('Relations: all 2522 source records, exact meanings, common-meaning coverage and spelling highlights passed.');
}

async function testLazyLoader() {
  const attempts = [];
  const builds = [];
  const requireMock = name => {
    assert.strictEqual(name, './relations-engine');
    return { build(...args) { builds.push(args); return { wordId: args[0] }; } };
  };
  requireMock.async = name => {
    assert.strictEqual(name, '../relation-data/ready.js');
    const request = deferred(); attempts.push(request); return request.promise;
  };
  const loader = evaluate('utils/relations.js', requireMock);
  const one = loader.load();
  const two = loader.load();
  assert.strictEqual(one, two, 'concurrent opens share one subpackage request');
  await flush();
  assert.strictEqual(attempts.length, 1);
  const rejection = assert.rejects(one, /offline/);
  attempts[0].reject(new Error('offline'));
  await rejection;
  const retried = loader.load();
  await flush();
  assert.strictEqual(attempts.length, 2, 'a failed download can retry');
  attempts[1].resolve(relationData);
  assert.strictEqual(await retried, relationData);
  assert.strictEqual(await loader.load(), relationData);
  assert.strictEqual(attempts.length, 2, 'loaded data is reused offline');
  const result = await loader.forWord('c-3-9', state);
  assert.strictEqual(result.wordId, 'c-3-9');
  assert.strictEqual(builds[0][1], relationData);
  assert.strictEqual(builds[0][2], state);
}

async function testComponent() {
  let definition;
  const requests = [];
  const events = [];
  let reads = 0;
  const stateBefore = JSON.stringify(state);
  const requireMock = name => {
    if (name === '../../utils/relations') return { forWord(id, passedState) {
      assert.strictEqual(passedState, state);
      const request = deferred(); request.id = id; requests.push(request); return request.promise;
    } };
    if (name === '../../utils/store') return { getState() { reads += 1; return state; }, saveState() { assert.fail('relations must never save learning state'); }, saveSession() { assert.fail('relations must never write sessions'); } };
    if (name === '../../utils/copy-word') return () => {};
    assert.fail('unexpected component dependency: ' + name);
  };
  evaluate('components/word-relations/index.js', requireMock, { Component(value) { definition = value; } });
  const instance = Object.assign({ data: clone(definition.data), setData(values) { Object.assign(this.data, values); }, triggerEvent(name) { events.push(name); } }, definition.methods);
  const observe = (visible, id) => definition.observers['visible, wordId'].call(instance, visible, id);
  const makeResult = id => ({ target: { id }, semantic: Array.from({ length: 15 }, (_, n) => ({ head: 'semantic-' + n })), shapes: Array.from({ length: 13 }, (_, n) => ({ head: 'shape-' + n })) });

  observe(true, 'first');
  assert.strictEqual(instance.data.loading, true);
  instance.explore({ currentTarget: { dataset: { id: 'second' } } });
  assert.strictEqual(instance.data.canGoBack, true);
  requests[1].resolve(makeResult('second'));
  await flush();
  assert.strictEqual(instance.data.result.target.id, 'second');
  requests[0].resolve(makeResult('first'));
  await flush();
  assert.strictEqual(instance.data.result.target.id, 'second', 'slow earlier request must never overwrite a newer word');
  instance.moreSemantic();
  instance.moreShapes();
  assert.strictEqual(instance.data.semantic.length, 12);
  assert.strictEqual(instance.data.shapes.length, 12);
  instance.moreSemantic();
  instance.moreShapes();
  assert.strictEqual(instance.data.semantic.length, 15);
  assert.strictEqual(instance.data.shapes.length, 13);

  instance.goBack();
  assert.strictEqual(requests[2].id, 'first');
  requests[2].resolve(makeResult('first'));
  await flush();
  assert.strictEqual(instance.data.canGoBack, false);

  observe(true, 'closing');
  instance.close();
  const closedSnapshot = JSON.stringify(instance.data);
  requests[3].resolve(makeResult('closing'));
  await flush();
  assert.strictEqual(JSON.stringify(instance.data), closedSnapshot, 'late result after close must be ignored');
  assert.strictEqual(events[0], 'close');

  observe(true, 'hidden');
  observe(false, 'hidden');
  const hiddenSnapshot = JSON.stringify(instance.data);
  requests[4].reject(new Error('download failure'));
  await flush();
  assert.strictEqual(JSON.stringify(instance.data), hiddenSnapshot, 'late error after hiding must be ignored');

  observe(true, 'retry');
  requests[5].reject(new Error('offline'));
  await flush();
  assert.ok(instance.data.error.includes('重试'));
  assert.strictEqual(instance.data.loading, false);
  instance.retry();
  assert.strictEqual(requests[6].id, 'retry');
  assert.strictEqual(instance.data.error, '');
  requests[6].resolve(makeResult('retry'));
  await flush();
  assert.strictEqual(instance.data.result.target.id, 'retry');
  assert.strictEqual(instance.data.loading, false);

  observe(true, 'detached');
  definition.lifetimes.detached.call(instance);
  const detachedSnapshot = JSON.stringify(instance.data);
  requests[7].resolve(makeResult('detached'));
  await flush();
  assert.strictEqual(JSON.stringify(instance.data), detachedSnapshot);
  assert.strictEqual(reads, requests.length);
  assert.strictEqual(JSON.stringify(state), stateBefore, 'dialog exploration must not touch study data');
}

function testLibraryAndTemplates() {
  let library;
  global.Page = value => { library = value; };
  const writes = [];
  const stored = { mem_vocab_state_v1: clone(state), mem_vocab_settings_v1: { schemaVersion: 2, reviewLimitVersion: 1 } };
  global.wx = {
    getStorageSync: key => stored[key] ? clone(stored[key]) : '',
    setStorageSync: (key, value) => { writes.push(key); stored[key] = clone(value); },
    createInnerAudioContext: () => ({ onPlay() {}, onEnded() {}, onStop() {}, onError() {}, destroy() {} }),
  };
  delete require.cache[require.resolve('../pages/library/index')];
  require('../pages/library/index');
  library.data = clone(library.data);
  library.setData = function (values, callback) { Object.assign(this.data, values); if (callback) callback(); };
  library.onLoad();
  assert.strictEqual(library.data.viewMode, 'words', 'word list should be the default library view');
  library.openDay({ currentTarget: { dataset: { key: 'core-1' } } });
  assert.notStrictEqual(library.data.dayIndex, 0);
  library.onSearch({ detail: { value: 'liberate' } });
  assert.strictEqual(library.data.dayIndex, 0, 'typing a query must clear a stale day restriction');
  assert.ok(library.data.visibleWords.some(word => engine.headOf(word) === 'liberate'), 'search must find words outside the previously selected day');
  assert.strictEqual(library.data.viewMode, 'words');
  assert.deepStrictEqual(writes, [], 'searching must not write learning data');

  const libraryTemplate = source('pages/library/index.wxml');
  assert.ok(libraryTemplate.indexOf('bindtap="showWords"') < libraryTemplate.indexOf('bindtap="showDays"'), 'word list button must precede low-frequency day view');
  const studyTemplate = source('pages/study/index.wxml');
  assert.ok(/wx:if="\{\{revealed\}\}"[^>]*bindtap="openRelations"|bindtap="openRelations"[^>]*wx:if="\{\{revealed\}\}"/.test(studyTemplate), 'word relations must not leak the answer before recall is revealed');
  assert.ok(/wx:if="\{\{contextAnswered\}\}"[^>]*bindtap="openRelations"|bindtap="openRelations"[^>]*wx:if="\{\{contextAnswered\}\}"/.test(studyTemplate), 'context questions must be answered before relation meanings appear');
  const componentTemplate = source('components/word-relations/index.wxml');
  assert.ok(componentTemplate.indexOf('机构释义') < componentTemplate.indexOf('日常常用义'), 'institution meaning must come before everyday senses');
  const app = require('../app.json');
  assert.ok(app.subPackages.some(pack => pack.root === 'relation-data'), 'relation definitions must remain outside main package');
  const studyConfig = JSON.parse(source('pages/study/index.json'));
  assert.strictEqual(studyConfig.usingComponents['word-relations'], '/components/word-relations/index');
  const libraryConfig = JSON.parse(source('pages/library/index.json'));
  assert.ok(!libraryConfig.usingComponents || !libraryConfig.usingComponents['word-relations'], 'library changes are limited to list/search behavior');
  assert.ok(!libraryTemplate.includes('<word-relations'), 'relations are explored in the learning page, not by switching into the library');
}

function testStudyDialogIsInPlace() {
  let study;
  global.Page = value => { study = value; };
  const writes = [];
  const navigation = [];
  const localState = clone(state);
  localState.daily['2026-10-23'] = { newDone: 23, dueDone: 41, completedAt: 0 };
  const stored = { mem_vocab_state_v1: localState, mem_vocab_settings_v1: { schemaVersion: 2, reviewLimitVersion: 1 } };
  global.wx = {
    getStorageSync: key => stored[key] ? clone(stored[key]) : '',
    setStorageSync: (key, value) => { writes.push(key); stored[key] = clone(value); },
    navigateTo: value => navigation.push(['navigateTo', value]),
    navigateBack: value => navigation.push(['navigateBack', value]),
    redirectTo: value => navigation.push(['redirectTo', value]),
    reLaunch: value => navigation.push(['reLaunch', value]),
    switchTab: value => navigation.push(['switchTab', value]),
  };
  delete require.cache[require.resolve('../pages/study/index')];
  require('../pages/study/index');
  study.data = clone(study.data);
  study.setData = function (values, callback) { Object.assign(this.data, values); if (callback) callback(); };
  study.session = {
    day: '2026-10-23', index: 1,
    queue: [{ wordId: idFor('liberate'), phase: 'review', answered: true }, { wordId: idFor('deliberate'), phase: 'review', answered: false }, { wordId: idFor('migrate'), phase: 'new', answered: false }],
    dueDone: 1, newDone: 0, ratings: { hard: 1 },
  };
  study.data.word = getWord(idFor('deliberate'));
  const originalWord = study.data.word;
  const originalSession = JSON.stringify(study.session);
  const originalStorage = JSON.stringify(stored);

  study.openRelations();
  assert.strictEqual(study.data.relationsOpen, false, 'unrevealed recall cannot open a meaning popup');
  study.data.revealed = true;
  const beforeOpening = clone(study.data);
  study.openRelations();
  assert.strictEqual(study.data.relationsOpen, true);
  assert.strictEqual(study.data.relationWordId, originalWord.id);
  study.closeRelations();
  assert.strictEqual(study.data.relationsOpen, false);
  assert.strictEqual(study.data.word, originalWord, 'closing returns to the same live word object');
  const afterClosing = clone(study.data);
  delete beforeOpening.relationsOpen;
  delete beforeOpening.relationWordId;
  delete afterClosing.relationsOpen;
  delete afterClosing.relationWordId;
  assert.deepStrictEqual(afterClosing, beforeOpening, 'popup open/close must leave all other learning UI state unchanged');

  study.data.isContext = true;
  study.data.contextAnswered = false;
  study.openRelations();
  assert.strictEqual(study.data.relationsOpen, false, 'unanswered context question cannot open a meaning popup');
  study.data.contextAnswered = true;
  study.openRelations();
  assert.strictEqual(study.data.relationsOpen, true);
  study.closeRelations();
  assert.strictEqual(study.data.word, originalWord);
  assert.strictEqual(JSON.stringify(study.session), originalSession, 'dialog must not advance session.index, modify queue, or record an answer');
  assert.strictEqual(JSON.stringify(stored), originalStorage, 'daily progress and all persisted learning records are unchanged');
  assert.deepStrictEqual(writes, [], 'opening and closing require no learning-data writes');
  assert.deepStrictEqual(navigation, [], 'closing the popup must not navigate, relaunch, redirect or switch tabs');
}

(async function main() {
  testCorpus();
  await testLazyLoader();
  await testComponent();
  testLibraryAndTemplates();
  testStudyDialogIsInPlace();
  console.log('Relation loader caching/retry, dialog request races, in-place study resume, read-only behavior, recall gates and cross-day library search passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
