Component({
  data: {
    selected: 0,
    items: [
      { pagePath: '/pages/today/index', text: '今日', icon: 'home' },
      { pagePath: '/pages/library/index', text: '词库', icon: 'book' },
      { pagePath: '/pages/progress/index', text: '进度', icon: 'chart' },
    ],
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item || index === this.data.selected) return;
      const previous = this.data.selected;
      this.setData({ selected: index });
      wx.switchTab({
        url: item.pagePath,
        fail: () => this.setData({ selected: previous }),
      });
    },
  },
});
