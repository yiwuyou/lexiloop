const dates = require('../../utils/date');
const plan = require('../../utils/study-plan');
const store = require('../../utils/store');
const migrations = require('../../utils/migrations');

function shortDate(key) {
  const parts = key.split('-');
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

Page({
  data: {
    dueCompletionRate: 0,
    firstRecognitionRate: 0,
    firstRoundEstimate: '',
    progress: 0,
    stats: null,
    week: [],
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 2 });
    this.refresh();
  },

  refresh() {
    const state = store.getState();
    const settings = store.getSettings();
    const stats = plan.progressStats(state);
    const keys = dates.recentDayKeys(7);
    let dueGoal = 0;
    let dueDone = 0;
    const week = keys.map((key) => {
      const day = state.daily[key];
      const goal = day ? (day.newGoal || 0) + (day.dueGoal || 0) : 0;
      const done = day ? (day.newDone || 0) + (day.dueDone || 0) : 0;
      if (day) {
        dueGoal += day.dueGoal || 0;
        dueDone += day.dueDone || 0;
      }
      const rate = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
      return {
        key,
        label: shortDate(key),
        rate,
        height: Math.max(6, rate),
        status: rate >= 100 ? 'done' : rate > 0 ? 'partial' : 'missed',
      };
    });

    const since = Date.now() - 7 * dates.DAY_MS;
    const newReviews = (state.recentReviews || []).filter((review) => review.at >= since && review.phase === 'new');
    const recognized = newReviews.filter((review) => review.result === 'good' || review.result === 'easy').length;
    const remainingDays = Math.ceil((stats.total - stats.learned) / settings.dailyNewCount);
    const estimate = new Date(Date.now() + remainingDays * dates.DAY_MS);

    this.setData({
      dueCompletionRate: dueGoal ? Math.round((dueDone / dueGoal) * 100) : 0,
      firstRecognitionRate: newReviews.length ? Math.round((recognized / newReviews.length) * 100) : 0,
      firstRoundEstimate: `${estimate.getMonth() + 1}月${estimate.getDate()}日前后`,
      progress: Math.round((stats.learned / stats.total) * 100),
      stats,
      week,
    });
  },

  exportBackup() {
    const state = store.getState();
    const settings = store.getSettings();
    const payload = JSON.stringify({
      type: 'mem-vocab-backup',
      formatVersion: migrations.CURRENT_BACKUP_FORMAT,
      stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA,
      appVersion: '0.2.0',
      exportedAt: Date.now(),
      state,
      settings,
    });
    const name = `词序学习备份-${dates.dayKey()}.json`;
    const filePath = `${wx.env.USER_DATA_PATH}/${name}`;
    const fs = wx.getFileSystemManager();
    fs.writeFile({
      filePath,
      data: payload,
      encoding: 'utf8',
      success: () => {
        if (wx.shareFileMessage) {
          wx.shareFileMessage({
            filePath,
            fileName: name,
            fail: () => wx.showToast({ title: '分享取消，备份未丢失', icon: 'none' }),
          });
        } else {
          wx.showModal({ title: '备份已生成', content: '当前微信版本不支持直接分享文件，请升级微信后重试。', showCancel: false });
        }
      },
      fail: () => wx.showToast({ title: '生成备份失败', icon: 'none' }),
    });
  },

  importBackup() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (readResult) => {
            try {
              const backup = JSON.parse(readResult.data);
              const migrated = migrations.migrateBackup(backup);
              wx.showModal({
                title: '恢复学习记录？',
                content: '恢复会覆盖这部手机当前的学习进度，词库内容不会改变。',
                confirmText: '确认恢复',
                success: (modal) => {
                  if (!modal.confirm) return;
                  store.saveState(migrated.state);
                  store.saveSettings(migrated.settings);
                  store.clearSession();
                  wx.showToast({ title: '恢复成功' });
                  this.refresh();
                },
              });
            } catch (error) {
              wx.showToast({ title: '备份文件无效', icon: 'none' });
            }
          },
          fail: () => wx.showToast({ title: '读取备份失败', icon: 'none' }),
        });
      },
    });
  },
});
