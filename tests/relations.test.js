const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getWords, getWord } = require('../utils/words');
const engine = require('../relation-data/engine');
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

  const reviewed = require('../data/word-relations.json').semanticPairs;
  reviewed.forEach(pair => {
    for (const [from, to] of [pair.words, pair.words.slice().reverse()]) {
      const link = engine.build(idFor(from), relationData, state).semantic.find(item => item.head === to);
      assert.ok(link, from + ' must link to ' + to + ' in both directions');
      assert.strictEqual(link.sense, pair.sense);
      assert.strictEqual(link.note, pair.note, 'keep the sense boundary and usage distinction');
    }
  });
  assert.ok(!engine.build(idFor('include'), relationData, state).semantic.some(item => item.head === 'require'), 'do not invent transitive synonyms via involve');

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
  assert.strictEqual(results.get('overhaul').target.breakdown, 'over + haul');
  assert.ok(results.get('overhaul').target.breakdownNote.includes('haul：拖、拉'));
  for (const [left, right] of [['overhaul', 'overhead'], ['overhaul', 'overhear'], ['overhead', 'overhear']]) {
    const link = results.get(left).shapes.find(item => item.head === right);
    assert.ok(link, left + ' should retain useful over- comparisons');
    assert.strictEqual(link.shared, 'over', 'shared highlight must stop at the reviewed prefix boundary');
    assert.ok(!link.shared.includes('h') && link.note.includes('over + '));
  }
  assert.ok(!results.get('overhaul').shapes.some(item => item.head === 'haul'), 'do not invent an out-of-bank word');
  const learnedState = clone(state);
  learnedState.cards[idFor('ponder')] = { seen: true };
  const learnedResult = engine.build(idFor('deliberate'), relationData, learnedState);
  assert.strictEqual(learnedResult.semantic[0].head, 'ponder', 'prefer already learned comparison words');
  console.log('Relations: all 2522 source records, exact meanings, common-meaning coverage and spelling highlights passed.');
}

async function testLazyLoader() {
  const attempts = [];
  const builds = [];
  const requireMock = () => { assert.fail('relation engine must remain in its lazy subpackage'); };
  const engineMock = { build(...args) { builds.push(args); return { wordId: args[0] }; } };
  requireMock.async = name => {
    if (name === '../relation-data/engine.js') return Promise.resolve(engineMock);
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
  const cold = evaluate('utils/relations.js', Object.assign(() => {}, { async: name => Promise.resolve(name.endsWith('engine.js') ? engineMock : relationData) }));
  assert.strictEqual((await cold.forWord('cold-first-open', state)).wordId, 'cold-first-open', 'first popup must await both data and engine');
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
  const closeTasks = new Map(); let taskId = 0;
  evaluate('components/word-relations/index.js', requireMock, {
    Component(value) { definition = value; },
    setTimeout(fn) { closeTasks.set(++taskId, fn); return taskId; }, clearTimeout(id) { closeTasks.delete(id); },
  });
  const instance = Object.assign({ data: clone(definition.data), setData(values) { Object.assign(this.data, values); }, triggerEvent(name) { events.push(name); } }, definition.methods);
  const observe = (visible, id) => definition.observers['visible, wordId'].call(instance, visible, id);
  const makeResult = id => ({ target: { id }, semantic: Array.from({ length: 15 }, (_, n) => ({ head: 'semantic-' + n })), shapes: Array.from({ length: 13 }, (_, n) => ({ head: 'shape-' + n })) });

  observe(true, 'first');
  assert.strictEqual(instance.data.loading, true);
  instance.openDetail({ currentTarget: { dataset: { id: 'second' } } });
  assert.strictEqual(events.pop(), 'detail');
  assert.strictEqual(requests.length, 1, 'related words open details without starting another relation request');
  assert.strictEqual(instance.explore, undefined);
  observe(true, 'second');
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

  observe(true, 'first');
  assert.strictEqual(requests[2].id, 'first');
  requests[2].resolve(makeResult('first'));
  await flush();
  assert.strictEqual(instance.data.result.target.id, 'first');

  observe(true, 'closing');
  instance.close();
  assert.strictEqual(instance.data.closing, true);
  instance.close();
  assert.strictEqual(closeTasks.size, 1, 'duplicate touch/tap must trigger only one close animation');
  closeTasks.get(taskId)(); closeTasks.delete(taskId);
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

function testDismissGestures() {
  let definition;
  let gestureTime = 1000;
  const tasks = new Map(); let next = 0;
  evaluate('components/word-relations/index.js', () => ({}), {
    Component(value) { definition = value; },
    Date: { now: () => gestureTime },
    setTimeout(fn) { tasks.set(++next, fn); return next; }, clearTimeout(id) { tasks.delete(id); },
  });
  const make = () => Object.assign({ data: clone(definition.data), events: [], updates: 0, setData(value) { this.updates++; Object.assign(this.data, value); }, triggerEvent(name) { this.events.push(name); } }, definition.methods);
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
  const mask = make(); mask.maskStart(touch(30, 60)); mask.maskEnd(touch(34, 65)); mask.close();
  assert.strictEqual(mask.data.closing, true);
  tasks.get(mask.closeTimer)(); tasks.delete(mask.closeTimer);
  assert.deepStrictEqual(mask.events, ['close'], 'backdrop tap closes once, without activating the parent');
  const moved = make(); moved.maskStart(touch(30, 60)); moved.maskEnd(touch(30, 95));
  assert.strictEqual(moved.data.closing, false, 'moving across backdrop is not a tap');
  const drag = make(); drag.dragStart(touch(100, 10)); drag.dragMove(touch(104, 85));
  assert.strictEqual(drag.data.dragY, 75);
  drag.dragEnd(touch(104, 85)); assert.strictEqual(drag.data.closing, true);
  const short = make(); short.dragStart(touch(100, 10)); short.dragMove(touch(101, 45)); short.dragEnd(touch(101, 45));
  assert.strictEqual(short.data.closing, false); assert.strictEqual(short.data.dragY, 0);
  const horizontal = make(); horizontal.dragStart(touch(100, 10)); horizontal.dragMove(touch(200, 30)); horizontal.dragEnd(touch(200, 100));
  assert.strictEqual(horizontal.data.closing, false, 'horizontal swipes cannot dismiss');
  const cancelled = make(); cancelled.dragStart(touch(100, 10)); cancelled.dragMove(touch(102, 100)); cancelled.dragCancel(); cancelled.dragEnd(touch(102, 100));
  assert.strictEqual(cancelled.data.closing, false);
  const detached = make(); detached.close(); definition.lifetimes.detached.call(detached);
  assert.ok(!tasks.has(detached.closeTimer), 'detaching cancels delayed parent close');
  assert.deepStrictEqual(cancelled.events, []);
  const pull = make(); pull.contentScroll({ detail: { scrollTop: 0 } });
  pull.contentStart(touch(100, 200)); pull.contentMove(touch(103, 275));
  assert.strictEqual(pull.data.dragging, true); assert.strictEqual(pull.data.dragY, 75);
  pull.contentEnd(touch(103, 275)); assert.strictEqual(pull.data.closing, true, 'downward pull from the top closes the panel');
  tasks.get(pull.closeTimer)(); tasks.delete(pull.closeTimer);
  assert.deepStrictEqual(pull.events, ['close']);
  const scroll = make(); scroll.contentScroll({ detail: { scrollTop: 180 } });
  scroll.contentStart(touch(100, 200)); scroll.contentMove(touch(100, 260));
  scroll.contentScroll({ detail: { scrollTop: 0 } }); scroll.contentMove(touch(100, 330)); scroll.contentEnd(touch(100, 330));
  assert.strictEqual(scroll.data.closing, false, 'scrolling back to the top cannot turn into dismissal within the same gesture');
  assert.strictEqual(scroll.updates, 0, 'normal native scrolling must not send per-frame UI bridge writes');
  const upward = make(); upward.contentStart(touch(100, 200)); upward.contentMove(touch(100, 160));
  upward.contentMove(touch(100, 290)); upward.contentEnd(touch(100, 290));
  assert.strictEqual(upward.data.closing, false, 'an upward scroll cannot reverse into an accidental close');
  const brief = make(); brief.contentStart(touch(100, 200)); brief.contentMove(touch(100, 235)); brief.contentEnd(touch(100, 235));
  assert.strictEqual(brief.data.closing, false); assert.strictEqual(brief.data.dragY, 0); assert.strictEqual(brief.data.dragging, false);
  brief.openDetail({ currentTarget: { dataset: { id: 'word-after-drag' } } });
  assert.deepStrictEqual(brief.events, [], 'a drag must not also open the word under the release point');
  gestureTime += 201;
  brief.openDetail({ currentTarget: { dataset: { id: 'word-after-drag' } } });
  assert.deepStrictEqual(brief.events, ['detail'], 'an intentional tap works again after the drag');
  const multiple = make(); multiple.contentStart(touch(100, 200));
  multiple.contentMove({ touches: [{ clientX: 100, clientY: 280 }, { clientX: 120, clientY: 280 }] }); multiple.contentEnd(touch(100, 280));
  assert.strictEqual(multiple.data.closing, false, 'multi-touch cancels dismissal');
  const staleScroll = make(); staleScroll.contentStart(touch(100, 200)); staleScroll.contentMove(touch(100, 230));
  staleScroll.contentScroll({ detail: { scrollTop: 40 } }); staleScroll.contentEnd(touch(100, 290));
  assert.strictEqual(staleScroll.data.closing, false, 'a delayed native scroll position update cancels a false top-of-list drag');
  const contentCancel = make(); contentCancel.contentStart(touch(100, 200)); contentCancel.contentMove(touch(100, 280)); contentCancel.contentCancel(); contentCancel.contentEnd(touch(100, 280));
  assert.strictEqual(contentCancel.data.closing, false);
  definition.observers['visible, wordId'].call(contentCancel, false, '');
  assert.strictEqual(contentCancel.contentScrollTop, 0); assert.strictEqual(contentCancel.isTapBlocked(), false, 'reopening resets stale gesture guards');
  const template = source('components/word-relations/index.wxml');
  assert.ok(/relation-backdrop[^>]*catchtap="close"/.test(template));
  assert.ok(/sheet-handle[^>]*catchtouchstart="dragStart"/.test(template));
  assert.ok(!/sheet-scroll[^>]*catchtouchmove/.test(template), 'ordinary list scrolling must retain its native move events');
  assert.ok(/sheet-scroll[^>]*bindscroll="contentScroll"/.test(template));
  assert.ok(/sheet-scroll[^>]*bindtouchstart="contentStart"[^>]*bindtouchend="contentEnd"/.test(template));
  assert.ok(/sheet-head[^>]*bindtouchstart="dragStart"/.test(template), 'the title area also supports pulling down');
}

function testLibraryAndTemplates() {
  let library;
  global.Page = value => { library = value; };
  const writes = [];
  const stored = { mem_vocab_state_v1: clone(state), mem_vocab_settings_v1: { schemaVersion: 2, reviewLimitVersion: 1, examPlanVersion: 1 } };
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
  const studyTemplate = source('pages/study/index.wxml') + source('components/word-card/index.wxml');
  assert.ok(/wx:if="\{\{(?:showRelations && )?revealed\}\}"[^>]*bindtap="openRelations"|bindtap="openRelations"[^>]*wx:if="\{\{(?:showRelations && )?revealed\}\}"/.test(studyTemplate), 'word relations must not leak the answer before recall is revealed');
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
  const stored = { mem_vocab_state_v1: localState, mem_vocab_settings_v1: { schemaVersion: 2, reviewLimitVersion: 1, examPlanVersion: 1 } };
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
    day: require('../utils/date').dayKey(Date.now()), index: 1,
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
  study.data.contentScrollTop = 180;
  study.openWordDetail({ detail: { wordId: idFor('migrate') } });
  assert.ok(navigation[0][1].url.startsWith('/word-detail/index?id='));
  study.data.relationsOpen = false;
  study.data.revealed = false;
  study.data.contextAnswered = false;
  study.data.contentScrollTop = 0;
  study.onShow();
  assert.strictEqual(study.data.relationsOpen, true);
  assert.strictEqual(study.data.revealed, true);
  assert.strictEqual(study.data.contextAnswered, true);
  assert.strictEqual(study.data.contentScrollTop, 180);
  assert.strictEqual(study.data.word, originalWord, 'detail return preserves the same learning word');
  assert.strictEqual(JSON.stringify(study.session), originalSession);
  assert.deepStrictEqual(writes, [], 'detail navigation does not submit an answer');
  if (study.stopSync) study.stopSync();
}

function testDetailRelationsNavigation() {
  let definition;
  const navigation = [], warnings = [];
  const current = { route: 'word-detail/index', data: { word: getWord(idFor('include')) } };
  let pages = [{ route: 'pages/library/index' }, current];
  const before = JSON.stringify(state);
  const dependencies = {
    '../utils/words': { getWord },
    '../utils/store': { getState: () => state, saveState() { assert.fail('detail exploration must not grade or change learning state'); } },
    '../utils/weak-book': { isMarked: () => false },
    '../utils/sentence-book': { has: () => false },
    '../utils/audio': {},
    '../utils/learning-clock': { enter() {} },
  };
  evaluate('word-detail/index.js', name => {
    assert.ok(dependencies[name], name); return dependencies[name];
  }, {
    Page(value) { definition = value; },
    getCurrentPages: () => pages,
    wx: {
      navigateTo(options) { navigation.push(['to', options]); },
      navigateBack(options) { navigation.push(['back', options]); },
      showToast(options) { warnings.push(options.title); },
    },
  });
  const detail = Object.assign({}, definition, {
    data: Object.assign(clone(definition.data), { word: current.data.word }),
    setData(patch) { Object.assign(this.data, patch); },
  });
  detail.openRelations();
  assert.strictEqual(detail.data.relationsOpen, true);
  detail.closeRelations();
  assert.strictEqual(detail.data.relationsOpen, false);
  detail.openRelations();
  const openInvolve = { detail: { wordId: idFor('involve') } };
  detail.openWordDetail(openInvolve);
  detail.openWordDetail(openInvolve);
  assert.strictEqual(navigation.length, 1, 'double taps must not push duplicate detail pages');
  assert.ok(navigation[0][1].url.endsWith('id=' + idFor('involve')));
  assert.strictEqual(detail.data.word.id, idFor('include'));
  assert.strictEqual(detail.data.relationsOpen, true, 'return to the same source relation list');
  navigation[0][1].fail();
  assert.strictEqual(detail.openingDetail, false, 'failed navigation permits another attempt');
  assert.strictEqual(warnings.length, 1);
  detail.onShow();
  assert.strictEqual(detail.data.relationsOpen, true);
  const earlier = { route: 'word-detail/index', data: { word: getWord(idFor('involve')), relationsOpen: true }, setData(patch) { Object.assign(this.data, patch); } };
  pages = [earlier, current];
  detail.openWordDetail(openInvolve);
  assert.strictEqual(navigation[1][0], 'back', 'revisiting an open word reuses its existing detail page');
  assert.strictEqual(navigation[1][1].delta, 1);
  navigation[1][1].success();
  assert.strictEqual(earlier.data.relationsOpen, false, 'the selected word must show its complete detail card, not an old popup');
  detail.onShow();
  detail.openWordDetail({ detail: { wordId: 'missing' } });
  assert.strictEqual(navigation.length, 2);
  assert.strictEqual(JSON.stringify(state), before);
  const config = JSON.parse(source('word-detail/index.json'));
  assert.strictEqual(config.usingComponents['word-relations'], '/components/word-relations/index');
  assert.ok(source('word-detail/index.wxml').includes('bindclose="closeRelations"'));
}

(async function main() {
  testCorpus();
  await testLazyLoader();
  await testComponent();
  testDismissGestures();
  testLibraryAndTemplates();
  testStudyDialogIsInPlace();
  testDetailRelationsNavigation();
  console.log('Relation loader caching/retry, dialog request races, in-place study resume, read-only behavior, recall gates and cross-day library search passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
