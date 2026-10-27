const store = require('./utils/store');
const audio = require('./utils/audio');
const recoveryRelease = require('./utils/recovery-release');

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
    try {
      recoveryRelease.run(store);
    } catch (error) {
      wx.showToast({ title: '进度补回失败，请勿清缓存，稍后重试', icon: 'none' });
    }
    wx.onNetworkStatusChange((event) => { if (event.isConnected) audio.prepare(); });
  },
  onShow() { prepareAudioWhenOnline(); },
});
