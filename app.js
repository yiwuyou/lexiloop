const store = require('./utils/store');
const audio = require('./utils/audio');

function prepareAudioWhenOnline() {
  wx.getNetworkType({
    success(result) {
      if (result.networkType !== 'none') audio.prepare();
    },
  });
}

App({
  onLaunch() {
    store.ensureState();
    wx.onNetworkStatusChange((event) => { if (event.isConnected) audio.prepare(); });
  },
  onShow() { prepareAudioWhenOnline(); },
});
