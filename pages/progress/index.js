const dates = require('../../utils/date');
const appVersion = require('../../utils/version');
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
    backupBusy: false,
    backupReady: false,
    backupStatus: '',
    restoreTextOpen: false,
    restoreText: '',
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
    if (this.data.backupBusy) return;
    this.setData({ backupBusy: true, backupReady: false, backupStatus: '' });
    try {
    const state = store.getState();
    const settings = store.getSettings();
    const payload = JSON.stringify({
      type: 'mem-vocab-backup',
      formatVersion: migrations.CURRENT_BACKUP_FORMAT,
      stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA,
      appVersion,
      exportedAt: Date.now(),
      state,
      settings,
    });
    const name = `lexiloop-backup-${dates.dayKey()}-${Date.now()}.json`;
    const filePath = `${wx.env.USER_DATA_PATH}/${name}`;
    this.backupPayload = payload;
    const fs = wx.getFileSystemManager();
    fs.writeFile({
      filePath,
      data: payload,
      encoding: 'utf8',
      success: () => {
        this.backupFile = { filePath, fileName: name };
        this.setData({ backupBusy: false, backupReady: true, backupStatus: '文件已生成，但还没有备份到小程序外。请点“发送备份文件”保存到文件传输助手。' });
      },
      fail: (error) => {
        this.backupFile = null;
        this.setData({ backupBusy: false, backupReady: true, backupStatus: `生成文件失败：${error.errMsg || '未知错误'}。可复制备份文本保存。` });
      },
    });
    } catch (error) {
      this.setData({ backupBusy: false, backupStatus: '读取记录或生成备份失败，请重试；原记录未改动。' });
    }
  },

  sendBackupFile() {
    if (!this.backupFile || typeof wx.shareFileMessage !== 'function') {
      this.setData({ backupStatus: '当前无法发送文件，请使用“复制备份文本”，粘贴到备忘录中保存。' });
      return;
    }
    // Keep this API in the direct button tap, not in an async filesystem callback.
    wx.shareFileMessage(Object.assign({}, this.backupFile, {
      success: () => this.setData({ backupStatus: '文件分享已完成，请到目标聊天确认备份文件已收到。' }),
      fail: (error) => {
        const detail = error.errMsg || '未知错误';
        const cancelled = /cancel/i.test(detail);
        this.setData({ backupStatus: cancelled
          ? '你取消了发送，文件仍只在小程序内。请重新发送或复制文本保存。'
          : `文件分享失败：${detail}。请重试，或复制备份文本保存到备忘录。` });
      },
    }));
  },

  copyBackupText() {
    if (!this.backupPayload) return;
    wx.setClipboardData({ data: this.backupPayload,
      success: () => this.setData({ backupStatus: '已复制完整备份文本。请立即粘贴到备忘录并保存；剪贴板本身不是备份。恢复时可粘贴回来。' }),
      fail: () => this.setData({ backupStatus: '复制失败，请重试或发送备份文件。' }),
    });
  },

  toggleTextRestore() { this.setData({ restoreTextOpen: !this.data.restoreTextOpen }); },
  onRestoreText(event) { this.setData({ restoreText: event.detail.value }); },
  restoreFromText() { this.restorePayload(this.data.restoreText); },

  restorePayload(text) {
    try {
      const migrated = migrations.migrateBackup(JSON.parse(text));
      wx.showModal({
        title: '恢复学习记录？',
        content: '恢复会覆盖这部手机当前的学习进度。建议先导出当前记录，再确认恢复。',
        confirmText: '确认恢复',
        success: (modal) => {
          if (!modal.confirm) return;
          store.saveState(migrated.state);
          store.saveSettings(migrated.settings);
          store.clearSession();
          store.clearSession('practice');
          this.setData({ restoreTextOpen: false, restoreText: '', backupReady: false, backupStatus: '' });
          this.backupPayload = null;
          this.backupFile = null;
          wx.showToast({ title: '恢复成功' });
          this.refresh();
        },
      });
    } catch (error) {
      wx.showModal({ title: '无法恢复', content: '备份内容无效、不完整或来自更高版本。当前学习记录没有被改动，请检查备份。', showCancel: false });
    }
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
            this.restorePayload(readResult.data);
          },
          fail: () => wx.showToast({ title: '读取备份失败', icon: 'none' }),
        });
      },
    });
  },
});
