const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tap = require('../utils/sentence-tap');
const { getWords } = require('../utils/words');
const store = require('../utils/store');
const clone = value => JSON.parse(JSON.stringify(value));
const values = {};
let failSave = false;
let writes = 0;
let toast;
let now = 10000;
const realNow = Date.now;
Date.now = () => now;
global.wx = {
  getStorageSync: key => values[key] ? clone(values[key]) : '',
  setStorageSync: (key, value) => {
    if (failSave && key === 'mem_vocab_state_v1') throw new Error('disk full');
    values[key] = clone(value); writes++;
  },
  removeStorageSync: key => { delete values[key]; },
  showToast: value => { toast = value; },
};
let page;
global.Page = value => { page = value; };
require('../pages/study/index');
function setData(patch, callback) {
  Object.entries(patch).forEach(([key, value]) => {
    const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = this.data;
    keys.slice(0, -1).forEach(part => { target = target[part]; });
    target[keys[keys.length - 1]] = value;
  });
  if (callback) callback();
}
function event(x = 20, y = 30, id = '') {
  return { touches: [{ pageX: x, pageY: y }], changedTouches: [{ pageX: x, pageY: y }], currentTarget: { dataset: { id } } };
}
function reset() {
  failSave = false;
  store.saveState({ schemaVersion: 3, cards: { 'c-1-1': { seen: true, reps: 4 } }, daily: { test: { newDone: 7 } }, weakBook: {}, recentReviews: [] });
  store.getSettings();
  writes = 0;
}

try {
  reset();
  page.data = clone(page.data);
  page.setData = setData;
  page.data.word = clone(getWords()[0]);
  page.data.revealed = true;
  page.contentRenderVersion = 7;
  page.data.contentHeight = 320;
  page.session = { index: 5, queue: [{ wordId: page.data.word.id }], ratings: { good: 3 } };
  const sessionBefore = clone(page.session);
  const original = clone(store.getState());
  let measure;
  wx.createSelectorQuery = () => ({ in() { return this; }, select() { return this; }, boundingClientRect() { return this; }, exec(fn) { measure = fn; } });

  // Delayed package/measurement completion during the very first save touch
  // must not move its target or require a second tap.
  page.onContentTouchStart();
  page.sentenceTouchStart(event());
  page.applyPhrase('new phrase 新短语', page.data.word.id, 7);
  assert.ok(page.pendingPhrase);
  page.fitAnswerContent();
  measure([{ height: 600 }, { height: 420 }]);
  assert.strictEqual(page.data.contentHeight, 320, 'do not resize a live touch target');
  page.sentenceTouchEnd(event());
  assert.strictEqual(page.data.isSentenceSaved, true, 'first short touch-end saves immediately');
  assert.strictEqual(writes, 1);
  page.tapSentence(event());
  assert.strictEqual(writes, 1, 'native tap after touch-end must not undo the save');
  page.onContentTouchEnd();
  clearTimeout(page.contentLayoutTimer);
  page.flushContentUpdates();
  assert.strictEqual(page.data.word.phrase, 'new phrase 新短语');
  assert.strictEqual(page.data.contentHeight, 420);
  const height = page.data.contentHeight;
  page.applyPhrase('another phrase 另一短语', page.data.word.id, 7);
  assert.strictEqual(page.data.contentHeight, height, 'late phrase must not reset the measured viewport');
  assert.deepStrictEqual(page.session, sessionBefore);
  assert.deepStrictEqual(store.getState().cards, original.cards);
  assert.deepStrictEqual(store.getState().daily, original.daily);

  // A second physical tap is a new gesture even when it is quick.
  now += 100;
  page.sentenceTouchStart(event());
  page.sentenceTouchEnd(event());
  page.tapSentence(event());
  assert.strictEqual(page.data.isSentenceSaved, false);
  assert.strictEqual(writes, 2);
  page.sentenceTouchStart(event());
  page.sentenceTouchMove(event(45, 60));
  page.sentenceTouchEnd(event(20, 30));
  page.tapSentence(event());
  assert.strictEqual(writes, 2, 'scrolling over save must not collect a sentence');
  page.sentenceTouchStart(event());
  now += 700;
  page.sentenceTouchEnd(event());
  page.tapSentence(event());
  assert.strictEqual(writes, 2, 'long press is not a save tap');
  page.sentenceTouchStart(event());
  page.sentenceTouchCancel();
  page.tapSentence(event());
  assert.strictEqual(writes, 2, 'cancelled gesture never saves');
  const lateTapPage = { toggleSentence() { this.count = (this.count || 0) + 1; } };
  tap.start.call(lateTapPage, Object.assign(event(), { timeStamp: 100 }));
  tap.end.call(lateTapPage, Object.assign(event(), { timeStamp: 170 }));
  now += 1000;
  tap.tap.call(lateTapPage, Object.assign(event(), { timeStamp: 175 }));
  assert.strictEqual(lateTapPage.count, 1, 'native timestamps deduplicate even when storage delayed delivery');
  now += 500;
  page.tapSentence({ currentTarget: { dataset: {} } });
  assert.strictEqual(page.data.isSentenceSaved, true, 'keyboard/accessibility tap still works');

  failSave = true;
  page.toggleSentence();
  assert.strictEqual(page.data.isSentenceSaved, true, 'failed write restores the previous visible state');
  assert.ok(toast.title.includes('重试'));
  assert.ok(store.getState().sentenceBook[page.data.word.example]);
  failSave = false;
  page.toggleSentence();
  assert.strictEqual(page.data.isSentenceSaved, false, 'save remains usable after a failure');

  page.fitAnswerContent();
  page.contentRenderVersion++;
  const stableHeight = page.data.contentHeight;
  measure([{ height: 50 }, { height: 50 }]);
  assert.strictEqual(page.data.contentHeight, stableHeight, 'old measurements cannot resize a later card');
  page.applyPhrase('stale 旧数据', page.data.word.id, 7);
  assert.notStrictEqual(page.data.word.phrase, 'stale 旧数据');

  // Context sentences save the displayed sentence, not the word's default one.
  page.data.isContext = true;
  page.data.question = { sentence: 'A different context sentence.', translation: '另一语境句。' };
  page.toggleSentence();
  assert.ok(store.getState().sentenceBook['A different context sentence.']);

  reset();
  delete require.cache[require.resolve('../pages/library/index')];
  require('../pages/library/index');
  page.data = clone(page.data);
  page.setData = setData;
  page.refresh = () => { throw new Error('save must not rebuild all 2522 library rows'); };
  const word = getWords()[0];
  page.data.visibleWords = [clone(word), Object.assign(clone(word), { id: 'shared-example-row' })];
  page.sentenceTouchStart(event(20, 30, word.id));
  page.sentenceTouchEnd(event(20, 30, word.id));
  page.tapSentence(event(20, 30, word.id));
  assert.strictEqual(writes, 1);
  assert.ok(page.data.visibleWords.every(item => item.isSentenceSaved));
  failSave = true;
  page.toggleSentence(event(20, 30, word.id));
  assert.ok(page.data.visibleWords.every(item => item.isSentenceSaved), 'all visible copies roll back together');
  failSave = false;

  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const dialog = read('components/word-relations/index.wxml');
  const css = read('components/word-relations/index.wxss');
  assert.ok(dialog.includes('class="back-slot"') && dialog.includes('class="sheet-title"'));
  assert.ok(css.includes('grid-template-columns: 104rpx minmax(0, 1fr) 88rpx'));
  assert.ok(/\.sheet-title\s*\{[^}]*white-space:\s*nowrap/.test(css));
  assert.ok(dialog.includes('semantic-group') && dialog.includes('shape-group'));
  assert.ok(css.includes('#eef7f2') && css.includes('#f3f1f9'), 'groups need distinct subtle backgrounds');
  for (const file of ['pages/study/index.wxml', 'pages/library/index.wxml']) {
    const markup = read(file);
    assert.ok(markup.includes('bindtouchend="sentenceTouchEnd"') && markup.includes('catchtap="tapSentence"'));
  }
  const studyStyles = read('pages/study/index.wxss');
  const cardMarkup = read('components/word-card/index.wxml');
  const studyMarkup = read('pages/study/index.wxml');
  assert.ok(!cardMarkup.includes('relation-trigger'), 'relations stay outside the scrolling word card and keep the word line clear');
  assert.ok(studyMarkup.indexOf('class="relation-trigger"') > studyMarkup.indexOf('</scroll-view>') && studyMarkup.indexOf('class="relation-trigger"') < studyMarkup.indexOf('class="rating-grid"'), 'the entry stays on the right above the ratings even when the card scrolls');
  assert.ok(!/<view class="word-heading">[\s\S]*?<button[\s\S]*?<\/view>/.test(cardMarkup.split('class="pronunciation"')[0]), 'the word heading must not share space with a button');
  assert.ok(/\.relation-trigger\s*\{[^}]*min-width:\s*76px[^}]*min-height:\s*44px/.test(studyStyles), 'the quiet bottom action retains a full touch target on narrow screens');
  assert.ok(!dialog.includes('class="section-note"') && !dialog.includes('class="footnote"'), 'internal sorting/matching/workflow notes must not clutter the learning dialog');
  assert.ok(dialog.includes('相近义项') && dialog.includes('机构释义'), 'retain word-specific learning content');
  console.log('First-touch collection, gesture deduplication/scroll cancellation, stable async layout, write failure rollback, context/library saves and dialog style guards passed.');
} finally {
  clearTimeout(page.contentLayoutTimer);
  Date.now = realNow;
}
