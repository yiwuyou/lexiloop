const { getWord } = require('../utils/words');
const store = require('../utils/store');
const weak = require('../utils/weak-book');
const sentences = require('../utils/sentence-book');
const resources = require('../utils/audio');
const clock = require('../utils/learning-clock');
Page({ data: { word: null, isWeakMarked: false, isSentenceSaved: false, audioLoading: false },
  onShow() { clock.enter('detail', Date.now(), 'detail'); },
  onLearningTouch() { clock.touch('detail', 'detail'); },
  onLoad(options) {
    const word = getWord(options.id);
    if (!word) { wx.showToast({ title: '没有找到这个单词', icon: 'none' }); wx.navigateBack(); return; }
    this.audio = require('../utils/audio-options').create();
    this.audio.onError(() => { if (this.playRequested && !this.disposed) { this.playRequested = false; wx.showToast({ title: '发音播放失败，请重试', icon: 'none' }); } });
    this.setData({ word }); this.refresh();
    require('../utils/phrases').phraseFor(word).then(phrase => { if (!this.disposed && phrase) this.setData({ 'word.phrase': phrase }); }).catch(() => {});
  },
  refresh() { if (!this.data.word) return; const state = store.getState(); this.setData({ isWeakMarked: weak.isMarked(state, this.data.word.id), isSentenceSaved: sentences.has(state, this.data.word.example) }); },
  async playPronunciation() { if (!this.audio) return; const request = this.request = (this.request || 0) + 1; this.setData({ audioLoading: true });
    try { const src = await resources.sourceFor(this.data.word); if (this.disposed || request !== this.request) return; this.playRequested = true; this.audio.src = src; this.audio.play(); }
    catch (error) { if (!this.disposed && request === this.request) { this.playRequested = false; wx.showToast({ title: '语音尚未准备好，联网后重试', icon: 'none' }); } }
    finally { if (!this.disposed && request === this.request) this.setData({ audioLoading: false }); }
  },
  toggleWeak() { const state = store.getState(); weak.toggle(state, this.data.word.id, Date.now()); store.saveState(state); this.refresh(); },
  toggleSentence() { const w = this.data.word; const state = store.getState(); sentences.toggle(state, { sentence: w.example, translation: w.translation, word: w.word, wordId: w.id }); store.saveState(state); this.refresh(); },
  goBack() {
    if (this.returning) return;
    this.returning = true;
    wx.navigateBack({ delta: 1, fail: () => { this.returning = false; wx.showToast({ title: '暂时无法返回，请重试', icon: 'none' }); } });
  },
  onHide() { clock.pause('detail'); this.request = (this.request || 0) + 1; this.playRequested = false; this.setData({ audioLoading: false }); if (this.audio) this.audio.stop(); },
  onUnload() { clock.pause('detail'); this.disposed = true; this.playRequested = false; this.request = (this.request || 0) + 1; if (this.audio) this.audio.destroy(); }
});
