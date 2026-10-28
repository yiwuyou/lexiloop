const store = require('./utils/store');
const audio = require('./utils/audio');
const recoveryRelease = require('./utils/recovery-release');
const cloudSync = require('./utils/cloud-sync');

function prepareAudioWhenOnline() {
  wx.getNetworkType({
    success(result) {
      if (result.networkType !== 'none') audio.prepare();
    },
  });
}

App({
  onLaunch() {
    store.resumeCloudApply();
    store.ensureState();
    try {
      recoveryRelease.run(store);
    } catch (error) {
      wx.showToast({ title: '进度补回失败，请勿清缓存，稍后重试', icon: 'none' });
    }
    cloudSync.start();
    wx.onNetworkStatusChange((event) => {
      if (event.isConnected) { audio.prepare(); cloudSync.foreground(true); }
    });
  },
  onShow() { prepareAudioWhenOnline(); cloudSync.foreground(); },
  onHide() { cloudSync.background(); },
});
