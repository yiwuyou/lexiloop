const store = require('./utils/store');
const audio = require('./utils/audio');

App({
  onLaunch() {
    store.ensureState();
    wx.onNetworkStatusChange((event) => { if (event.isConnected) audio.prepare(); });
  },
  onShow() { audio.prepare(); },
});
