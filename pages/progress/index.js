const dates = require('../../utils/date');
const appVersion = require('../../utils/version');
const plan = require('../../utils/study-plan');
const store = require('../../utils/store');
const migrations = require('../../utils/migrations');
const backupCodec = require('../../utils/sync-codec');
const recovery = require('../../utils/progress-recovery');
const cloudSync = require('../../utils/cloud-sync');

const recoveryGroups = recovery.checkpoints();
const initialRecoveryIndex = recoveryGroups.findIndex((group) => group.category === 'high' && group.day === 13);

function recoveryCounts(index) {
  return ['该日尚未开始'].concat(recoveryGroups[index].words.map((word, position, words) => `已学到 #${word.index} ${word.word}${position === words.length - 1 ? '（该日学完）' : ''}`));
}

function canSaveToDisk() {
  return typeof wx.saveFileToDisk === 'function'
    && (typeof wx.canIUse !== 'function' || wx.canIUse('saveFileToDisk'));
}

function shortDate(key) {
  const parts = key.split('-');
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

Page({
  data: {
    learningHistory: [], historyLimit: 7, historyCount: 0, expandedDay: '',
    dueCompletionRate: 0,
    firstRecognitionRate: 0,
    firstRoundEstimate: '',
    progress: 0,
    stats: null,
    week: [],
    backupBusy: false,
    backupReady: false,
    backupToDisk: false,
    backupHasFile: false,
    backupStatus: '',
    restoreTextOpen: false,
    restoreText: '',
    recoveryOpen: false,
    recoveryLabels: recoveryGroups.map((group) => group.label),
    recoveryIndex: initialRecoveryIndex,
    recoveryCounts: recoveryCounts(initialRecoveryIndex),
    recoveryCount: 0,
    recoveryPreview: null,
    recoveryStatus: '',
    recoveryBatch: recovery.REVIEW_BATCH,
    sync: { text: '尚未开启云同步', enabled: false, busy: false, pending: 0, last: '' },
    syncBusy: false,
    syncError: '',
    repairBackupAvailable: false,
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 2 });
    this.refresh();
    this.refreshRepairBackup();
    if (this.stopSync) this.stopSync();
    let revision;
    this.stopSync = cloudSync.subscribe(sync => {
      this.setData(sync.text === '已同步' ? { sync, syncError: '' } : { sync });
      const dataChanged = revision !== undefined && revision !== sync.dataRevision;
      revision = sync.dataRevision;
      if (dataChanged) this.refresh();
    });
  },
  onHide() { if (this.stopSync) this.stopSync(); },
  onUnload() { if (this.stopSync) this.stopSync(); },

  syncNow() { return this.runSync(false); },
  confirmCloudRead() {
    wx.showModal({
      title: '备份本机并接回云端',
      content: '请先确认最新的设备已同步。本机会补传同步队列中的记录，再读取云端进度。修复前的本机记录可在本页导出。',
      confirmText: '接回云端',
      success: result => { if (result.confirm) this.runSync(true); },
    });
  },

  refreshRepairBackup() {
    try { this.setData({ repairBackupAvailable: cloudSync.hasRepairBackup() }); }
    catch (_) { /* A backup read error is reported when the user exports. */ }
  },

  async runSync(preferCloud) {
    if (this.data.syncBusy) return;
    this.setData({ syncBusy: true, syncError: '' });
    try {
      if (cloudSync.status().enabled) await cloudSync.flush({ preferCloud });
      else await cloudSync.enable();
      this.refresh();
    } catch (error) {
      this.setData({ syncError: cloudSync.status().errorText || '同步未完成，本机记录已保留。请勿清缓存。' });
    } finally { this.setData({ syncBusy: false }); this.refreshRepairBackup(); }
  },

  copySyncError() {
    const text = cloudSync.status().errorText || this.data.syncError;
    if (text) wx.setClipboardData({ data: text });
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
      const task = day && day.taskStatus ? require('../../utils/learning-metrics').summary(state, null, key) : null;
      const done = task ? task.reviewSeen + task.newSeen : day ? (day.newDone || 0) + (day.dueDone || 0) : 0;
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
        status: day && day.completedAt ? 'done' : rate > 0 ? 'partial' : 'missed',
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
      learningHistory: require('../../utils/learning-history').rows(state, this.data.historyLimit), historyCount: Object.keys(state.daily).length,
      progress: Math.round((stats.learned / stats.total) * 100),
      stats,
      week,
      recoveryPreview: recovery.preview(state, this.data.recoveryIndex, this.data.recoveryCount),
    });
  },

  toggleDay(event) { this.setData({ expandedDay: this.data.expandedDay === event.currentTarget.dataset.day ? '' : event.currentTarget.dataset.day }); },
  moreHistory() { this.setData({ historyLimit: this.data.historyLimit + 30 }); this.refresh(); },
  toggleRecovery() { this.setData({ recoveryOpen: !this.data.recoveryOpen }); },
  onRecoveryDay(event) {
    const index = Number(event.detail.value);
    this.setData({ recoveryIndex: index, recoveryCount: 0, recoveryCounts: recoveryCounts(index) });
    this.refresh();
  },
  onRecoveryCount(event) {
    this.setData({ recoveryCount: Number(event.detail.value) });
    this.refresh();
  },
  recoverProgress() {
    const index = this.data.recoveryIndex;
    const count = this.data.recoveryCount;
    const summary = recovery.preview(store.getState(), index, count);
    if (!summary.added) {
      wx.showToast({ title: '所选范围已经记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '补回已学范围？',
      content: `${recoveryGroups[index].label}，${count ? `已学到该日第 ${count} 词` : '该日尚未开始'}。补回 ${summary.added} 条已学记录，按每天 ${recovery.REVIEW_BATCH} 词分批到期，并计入每日复习上限；实际完成时间取决于答题和复习情况。现有记录保留，不恢复旧成绩、收藏或易忘清单。`,
      confirmText: '补回进度',
      success: (result) => {
        if (!result.confirm) return;
        try {
          store.saveState(recovery.recover(store.getState(), index, count));
          store.clearSession();
          store.clearSession('practice');
          this.setData({ recoveryOpen: false, recoveryStatus: '已补回学习范围，旧答题历史并未恢复。新词会从未学范围继续；旧词全部待重新复习，分批安排，不代表已经掌握。' });
          this.refresh();
          wx.showToast({ title: '已补回进度' });
        } catch (error) {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      },
    });
  },

  exportBackup() { this.generateBackup(false); },
  exportRepairBackup() { this.generateBackup(true); },

  generateBackup(beforeRepair) {
    if (this.data.backupBusy) return;
    this.backupFile = null;
    this.backupPayload = null;
    this.setData({ backupBusy: true, backupReady: false, backupHasFile: false, backupStatus: '' });
    try {
      const snapshot = beforeRepair ? cloudSync.repairBackup() : { state: store.getState(), settings: store.getSettings() };
      if (!snapshot) throw Error('missing-repair-backup');
      const payload = JSON.stringify({
        type: 'mem-vocab-backup',
        formatVersion: migrations.CURRENT_BACKUP_FORMAT,
        stateSchemaVersion: migrations.CURRENT_STATE_SCHEMA,
        appVersion,
        exportedAt: Date.now(),
        state: snapshot.state,
        settings: snapshot.settings,
      });
      this.backupPayload = payload;
      const name = `lexiloop-backup-${dates.dayKey()}-${Date.now()}.json`;
      const filePath = `${wx.env.USER_DATA_PATH}/${name}`;
      const toDisk = canSaveToDisk();
      wx.getFileSystemManager().writeFile({
        filePath, data: payload, encoding: 'utf8',
        success: () => {
          this.backupFile = { filePath, fileName: name };
          const action = toDisk ? '保存到电脑' : '发送备份文件';
          this.setData({ backupBusy: false, backupReady: true, backupHasFile: true, backupToDisk: toDisk,
            backupStatus: '文件已生成，请点“' + action + '”把文件保存到小程序外。' });
        },
        fail: (error) => {
          this.setData({ backupBusy: false, backupReady: true,
            backupStatus: '生成文件失败：' + (error.errMsg || '未知错误') + '。可复制备份文本保存。' });
        },
      });
    } catch (error) {
      this.setData({ backupBusy: false, backupReady: Boolean(this.backupPayload),
        backupStatus: this.backupPayload ? '生成文件失败，可复制备份文本保存。' : '读取记录或生成备份失败，请重试。' });
    }
  },

  saveBackupFile() {
    if (!this.backupFile || !canSaveToDisk()) {
      this.setData({ backupStatus: '当前无法保存到电脑，请复制备份文本。' });
      return;
    }
    const fail = (error) => this.setData({ backupStatus: /cancel/i.test(error && error.errMsg || '')
      ? '已取消保存，可重新选择位置。'
      : '未保存到电脑，请使用“复制备份文本”。' });
    try {
      wx.saveFileToDisk({
        filePath: this.backupFile.filePath,
        success: () => this.setData({ backupStatus: '备份已保存到电脑，请确认所选位置有 JSON 文件。' }),
        fail,
      });
    } catch (error) { fail(error); }
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
          : /not.supported/i.test(detail) ? '当前微信不支持发送文件，请复制备份文本保存。'
          : `文件分享失败：${detail}。请重试，或复制备份文本保存。` });
      },
    }));
  },

  copyBackupText() {
    if (!this.backupPayload) return;
    let text = this.backupPayload;
    if (text.length >= 65536) {
      try {
        const packed = JSON.stringify({ type: 'mem-vocab-backup-text', packed: backupCodec.pack(text) });
        if (packed.length < text.length) text = packed;
      } catch (_) { /* The uncompressed format is still usable. */ }
    }
    wx.setClipboardData({ data: text,
      success: () => this.setData({ backupStatus: '已复制完整备份文本。请立即粘贴到备忘录并保存；剪贴板本身不是备份。恢复时可粘贴回来。' }),
      fail: () => this.setData({ backupStatus: '复制失败，请重试或发送备份文件。' }),
    });
  },

  toggleTextRestore() { this.setData({ restoreTextOpen: !this.data.restoreTextOpen }); },
  onRestoreText(event) { this.setData({ restoreText: event.detail.value }); },
  restoreFromText() { this.restorePayload(this.data.restoreText); },

  restorePayload(text) {
    try {
      let payload = JSON.parse(text);
      if (payload && payload.type === 'mem-vocab-backup-text') payload = JSON.parse(backupCodec.unpack(payload.packed));
      const migrated = migrations.migrateBackup(payload);
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
