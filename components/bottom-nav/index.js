Component({
  properties: {
    active: { type: String, value: 'today' },
  },

  methods: {
    navigate(event) {
      const target = event.currentTarget.dataset.target;
      if (!target || target === this.data.active) return;
      const routes = {
        today: '/pages/today/index',
        library: '/pages/library/index',
        progress: '/pages/progress/index',
      };
      wx.reLaunch({ url: routes[target] });
    },
  },
});
