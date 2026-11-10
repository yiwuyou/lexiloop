const { getWord, getWords } = require('../utils/words');
const PAGE_SIZE = 24;

Page({
  data: { query: '', rows: [], total: 0, hasMore: false, focus: true, scrollTop: 0 },

  onShow() { this.opening = false; },

  search(event) {
    const query = event.detail.value;
    const keyword = query.trim().toLowerCase();
    const exact = [], prefix = [], rest = [];
    if (keyword) getWords().forEach(word => {
      const head = word.spokenWord.toLowerCase();
      if (head === keyword || word.word.toLowerCase() === keyword) exact.push(word);
      else if (head.startsWith(keyword)) prefix.push(word);
      else if (word.searchText.includes(keyword)) rest.push(word);
    });
    this.matches = exact.concat(prefix, rest);
    this.limit = PAGE_SIZE;
    this.showMatches({ query, scrollTop: this.data.scrollTop ? 0 : 1 });
  },

  showMatches(patch) {
    const rows = this.matches.slice(0, this.limit).map(({ id, word, meaning, shortPartOfSpeech }) =>
      ({ id, word, meaning, shortPartOfSpeech }));
    this.setData(Object.assign({ rows, total: this.matches.length, hasMore: this.matches.length > this.limit }, patch));
  },

  loadMore() {
    if (!this.matches || !this.data.hasMore) return;
    this.limit += PAGE_SIZE;
    this.showMatches();
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (this.opening || !getWord(id)) return;
    this.opening = true;
    this.setData({ focus: false });
    wx.navigateTo({
      url: '/word-detail/index?id=' + encodeURIComponent(id),
      fail: () => {
        this.opening = false;
        wx.showToast({ title: '暂时无法打开该词，请重试', icon: 'none' });
      },
    });
  },
});
