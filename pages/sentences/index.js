const store = require('../../utils/store');
const book = require('../../utils/sentence-book');

Page({
  copyWord: require('../../utils/copy-word'),
  data: { entries: [], count: 0, hideEnglish: false, hideChinese: false, limit: 30 },
  onShow() { this.refresh(); },
  refresh() {
    const entries = book.list(store.getState());
    this.setData({ count: entries.length, entries: entries.slice(0, this.data.limit) });
  },
  toggleEnglish() { this.setData({ hideEnglish: !this.data.hideEnglish }); },
  toggleChinese() { this.setData({ hideChinese: !this.data.hideChinese }); },
  reveal(event) {
    const entries = this.data.entries.map((entry, index) => index === Number(event.currentTarget.dataset.index)
      ? Object.assign({}, entry, { revealed: !entry.revealed }) : entry);
    this.setData({ entries });
  },
  remove(event) {
    const entry = this.data.entries[Number(event.currentTarget.dataset.index)];
    if (!entry) return;
    const state = store.getState();
    book.toggle(state, entry);
    store.saveState(state);
    this.refresh();
  },
  more() { this.setData({ limit: this.data.limit + 30 }); this.refresh(); },
});
