const scheduler = require('../../utils/scheduler');
const store = require('../../utils/store');
const { getWords } = require('../../utils/words');

const PAGE_SIZE = 60;

function decorate(word, card) {
  let state = 'unseen';
  let stateLabel = '未学习';
  if (card && card.seen) {
    state = 'learning';
    stateLabel = '学习中';
    if (scheduler.isStable(card)) {
      state = 'stable';
      stateLabel = '稳定记得';
    } else if (scheduler.isWeak(card)) {
      state = 'weak';
      stateLabel = '易忘';
    }
  }
  return Object.assign({}, word, { state, stateLabel });
}

Page({
  data: {
    activeFilter: 'all',
    hasMore: false,
    query: '',
    resultCount: 0,
    visibleWords: [],
  },

  onLoad() {
    this.audio = wx.createInnerAudioContext();
    this.audio.obeyMuteSwitch = false;
    this.audioPlaying = false;
    this.audioStarted = false;
    this.audio.onPlay(() => {
      this.audioPlaying = true;
      this.audioStarted = true;
    });
    this.audio.onEnded(() => { this.audioPlaying = false; });
    this.audio.onStop(() => { this.audioPlaying = false; });
    this.audio.onError((error) => {
      console.error('pronunciation audio error', error);
      this.audioPlaying = false;
      if (!this.audioStarted) wx.showToast({ title: '发音播放失败', icon: 'none' });
    });
    this.limit = PAGE_SIZE;
    this.refresh();
  },

  onUnload() {
    if (this.audio) this.audio.destroy();
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 1 });
    this.refresh();
  },

  refresh() {
    const state = store.getState();
    const query = this.data.query.trim().toLowerCase();
    const filter = this.data.activeFilter;
    const filtered = getWords()
      .map((word) => decorate(word, state.cards[word.id]))
      .filter((word) => {
        const matchesQuery = !query || word.searchText.includes(query);
        const matchesFilter = filter === 'all'
          || word.category === filter
          || (filter === 'weak' && word.state === 'weak');
        return matchesQuery && matchesFilter;
      });
    this.setData({
      hasMore: filtered.length > this.limit,
      resultCount: filtered.length,
      visibleWords: filtered.slice(0, this.limit),
    });
  },

  onSearch(event) {
    this.limit = PAGE_SIZE;
    this.setData({ query: event.detail.value }, () => this.refresh());
  },

  selectFilter(event) {
    this.limit = PAGE_SIZE;
    this.setData({ activeFilter: event.currentTarget.dataset.filter }, () => this.refresh());
  },

  loadMore() {
    this.limit += PAGE_SIZE;
    this.refresh();
  },

  playPronunciation(event) {
    const source = event.currentTarget.dataset.source;
    if (!source || !this.audio) return;
    if (this.audioPlaying) this.audio.stop();
    this.audioStarted = false;
    this.audio.src = source;
    this.audio.play();
  },
});
