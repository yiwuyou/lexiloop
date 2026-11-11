const scheduler = require('./utils/scheduler');
const audioOptions = require('./utils/audio-options');
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
    // Debug mode can persist after a diagnostic preview using the same AppID.
    // Keep the floating console out of the normal study interface.
    if (typeof wx.setEnableDebug === 'function') wx.setEnableDebug({ enableDebug: false });
    audioOptions.configure();
    scheduler.prepare().catch(() => {});
    require('./utils/sync-storage').compact();
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
  onHide() { try { require('./utils/learning-clock').pause(); } finally { cloudSync.background(); } },
});
