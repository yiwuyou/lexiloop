const scheduler = require('../../utils/scheduler');
const store = require('../../utils/store');
const { getWords, getWord } = require('../../utils/words');
const practice = require('../../utils/practice');
const audioResources = require('../../utils/audio');
const weakBook = require('../../utils/weak-book');

const PAGE_SIZE = 60;

function decorate(word, card, marked) {
  let state = 'unseen';
  let stateLabel = '未学习';
  if (marked) {
    state = 'weak';
    stateLabel = '易忘';
  } else if (card && card.seen) {
    state = 'learning';
    stateLabel = '学习中';
    if (scheduler.isStable(card)) {
      state = 'stable';
      stateLabel = '稳定记得';
    }
  }
  return Object.assign({}, word, { state, stateLabel, isWeakMarked: Boolean(marked) });
}

Page({
  data: {
    activeFilter: 'all',
    hasMore: false,
    query: '',
    resultCount: 0,
    visibleWords: [],
    dayOptions: [],
    dayIndex: 0,
    selectedDayLabel: '全部天数',
    dayGroups: [],
    viewMode: 'days',
    audioDownloadLabel: '下载全部发音，备好地铁离线学习',
    audioDownloading: false,
    audioSize: audioResources.sizeLabel,
    audioDownloadError: '',
    audioLoadingId: '',
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
    const groups = [];
    getWords().forEach((word) => {
      const key = `${word.category}-${word.day}`;
      if (!groups.some((group) => group.key === key)) groups.push({ key, category: word.category, day: word.day,
        label: `${word.category === 'core' ? '核心' : '高频'} day ${word.day}` });
    });
    this.groups = groups;
    this.setData({ dayOptions: [{ key: 'all', label: '全部天数' }].concat(groups) });
    this.refresh();
  },

  onUnload() {
    this.audioRequest = (this.audioRequest || 0) + 1;
    if (this.audio) this.audio.destroy();
    this.audio = null;
  },

  onHide() {
    this.setData({ audioLoadingId: '' });
    this.audioRequest = (this.audioRequest || 0) + 1;
    if (this.audioPlaying && this.audio) this.audio.stop();
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 1 });
    this.refresh();
  },

  refresh() {
    if (!this.groups) return;
    const state = store.getState();
    const query = this.data.query.trim().toLowerCase();
    const filter = this.data.activeFilter;
    const filtered = getWords()
      .map((word) => decorate(word, state.cards[word.id], weakBook.isMarked(state, word.id)))
      .filter((word) => {
        const matchesQuery = !query || word.searchText.includes(query);
        const matchesFilter = filter === 'all'
          || word.category === filter
          || (filter === 'weak' && word.state === 'weak');
        const selected = this.data.dayOptions[this.data.dayIndex];
        const matchesDay = selected.key === 'all' || (word.category === selected.category && word.day === selected.day);
        return matchesQuery && matchesFilter && matchesDay;
      });
    this.filteredWords = filtered;
    const dayGroups = this.groups.map((group) => {
      const members = filtered.filter((word) => word.category === group.category && word.day === group.day);
      return Object.assign({}, group, { total: members.length, learned: members.filter((word) => word.state !== 'unseen').length,
        countLabel: filter === 'weak' ? `易忘 ${members.length} 词` : `已学 ${members.filter((word) => word.state !== 'unseen').length} / ${members.length} 词` });
    }).filter((group) => group.total);
    this.setData({
      dayGroups,
      hasMore: filtered.length > this.limit,
      resultCount: filtered.length,
      visibleWords: filtered.slice(0, this.limit),
    });
  },

  onSearch(event) {
    this.limit = PAGE_SIZE;
    this.setData({ query: event.detail.value, viewMode: 'words' }, () => this.refresh());
  },

  selectFilter(event) {
    this.limit = PAGE_SIZE;
    this.setData({ activeFilter: event.currentTarget.dataset.filter, dayIndex: 0, selectedDayLabel: '全部天数' }, () => this.refresh());
  },

  changeDay(event) {
    const dayIndex = Number(event.detail.value);
    this.limit = PAGE_SIZE;
    this.setData({ dayIndex, selectedDayLabel: this.data.dayOptions[dayIndex].label, viewMode: 'words' }, () => this.refresh());
  },

  openDay(event) {
    const dayIndex = this.data.dayOptions.findIndex((day) => day.key === event.currentTarget.dataset.key);
    this.changeDay({ detail: { value: dayIndex } });
  },

  showDays() {
    this.setData({ viewMode: 'days', dayIndex: 0, selectedDayLabel: '全部天数' }, () => this.refresh());
  },

  showWords() { this.setData({ viewMode: 'words' }); },

  practiceDay() {
    const selected = this.data.dayOptions[this.data.dayIndex];
    const scope = this.data.activeFilter === 'weak' ? { scope: 'weak' } : {};
    const session = practice.buildSession(store.getState(), Object.assign(scope, selected.key === 'all' ? {} : selected));
    if (!session.queue.length) {
      wx.showToast({ title: '这一天还没有已学词', icon: 'none' });
      return;
    }
    store.saveSession(session);
    wx.navigateTo({ url: '/pages/study/index?mode=practice' });
  },

  toggleWeak(event) {
    const state = store.getState();
    const marked = weakBook.toggle(state, event.currentTarget.dataset.id, Date.now());
    store.saveState(state);
    wx.showToast({ title: marked ? '已加入易忘' : '已移出易忘', icon: 'none' });
    this.refresh();
  },

  loadMore() {
    this.limit += PAGE_SIZE;
    this.refresh();
  },

  async downloadAudio() {
    if (this.data.audioDownloading) return;
    this.setData({ audioDownloading: true, audioDownloadError: '', audioDownloadLabel: '正在准备语音…' });
    try {
      await audioResources.downloadAll((count, total, bytes) => this.setData({ audioDownloadLabel: `已准备 ${count}/${total} 包 · ${(bytes / 1000000).toFixed(1)}/${audioResources.sizeLabel}` }));
      this.setData({ audioDownloadLabel: '全部发音已准备好' });
    } catch (error) {
      this.setData({ audioDownloadLabel: '下载未完成，点此重试', audioDownloadError: audioResources.describeError(error) });
    } finally { this.setData({ audioDownloading: false }); }
  },

  async playPronunciation(event) {
    const word = getWord(event.currentTarget.dataset.id);
    if (!word || !this.audio) return;
    const request = this.audioRequest = (this.audioRequest || 0) + 1;
    this.setData({ audioLoadingId: word.id });
    try {
    const source = await audioResources.sourceFor(word);
    if (request !== this.audioRequest || !this.audio) return;
    if (this.audioPlaying) this.audio.stop();
    this.audioStarted = false;
    this.audio.src = source;
    this.audio.play();
    } catch (error) {
      if (request === this.audioRequest) wx.showModal({ title: '发音准备失败', content: audioResources.describeError(error), showCancel: false });
    } finally {
      if (request === this.audioRequest) this.setData({ audioLoadingId: '' });
    }
  },

  showExampleSource(event) {
    const word = getWord(event.currentTarget.dataset.id);
    if (word) wx.showModal({ title: '例句来源与说明', content: word.exampleSourceDetail, showCancel: false });
  },
});
