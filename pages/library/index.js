const scheduler = require('../../utils/scheduler');
const store = require('../../utils/store');
const { getWords, getWord } = require('../../utils/words');
const practice = require('../../utils/practice');
const audioResources = require('../../utils/audio');

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
    dayOptions: [],
    dayIndex: 0,
    selectedDayLabel: '全部天数',
    dayGroups: [],
    viewMode: 'days',
    audioDownloadLabel: '下载全部发音，备好地铁离线学习',
    audioDownloading: false,
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
      .map((word) => decorate(word, state.cards[word.id]))
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
      return Object.assign({}, group, { total: members.length, learned: members.filter((word) => word.state !== 'unseen').length });
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
    this.setData({ activeFilter: event.currentTarget.dataset.filter }, () => this.refresh());
  },

  changeDay(event) {
    const dayIndex = Number(event.detail.value);
    this.limit = PAGE_SIZE;
    this.setData({ dayIndex, activeFilter: 'all', selectedDayLabel: this.data.dayOptions[dayIndex].label, viewMode: 'words' }, () => this.refresh());
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
    const session = practice.buildSession(store.getState(), selected.key === 'all' ? {} : selected);
    if (!session.queue.length) {
      wx.showToast({ title: '这一天还没有已学词', icon: 'none' });
      return;
    }
    store.saveSession(session);
    wx.navigateTo({ url: '/pages/study/index?mode=practice' });
  },

  loadMore() {
    this.limit += PAGE_SIZE;
    this.refresh();
  },

  async downloadAudio() {
    if (this.data.audioDownloading) return;
    this.setData({ audioDownloading: true });
    try {
      await audioResources.downloadAll((count, total) => this.setData({ audioDownloadLabel: `准备发音 ${count} / ${total}` }));
      this.setData({ audioDownloadLabel: '全部发音已准备好' });
    } catch (error) {
      this.setData({ audioDownloadLabel: '下载中断，联网后点此继续' });
    } finally { this.setData({ audioDownloading: false }); }
  },

  async playPronunciation(event) {
    const word = getWord(event.currentTarget.dataset.id);
    if (!word || !this.audio) return;
    const request = this.audioRequest = (this.audioRequest || 0) + 1;
    try {
    const source = await audioResources.sourceFor(word);
    if (request !== this.audioRequest || !this.audio) return;
    if (this.audioPlaying) this.audio.stop();
    this.audioStarted = false;
    this.audio.src = source;
    this.audio.play();
    } catch (error) {
      if (request === this.audioRequest) wx.showToast({ title: '请联网准备该词发音后再试', icon: 'none' });
    }
  },
});
