const dates = require('../../utils/date');
const plan = require('../../utils/study-plan');
const store = require('../../utils/store');
const practice = require('../../utils/practice');
const audio = require('../../utils/audio');
const appVersion = require('../../utils/version');
const cloudSync = require('../../utils/cloud-sync');
const metrics = require('../../utils/learning-metrics');
const timeLedger = require('../../utils/time-ledger');

function greeting(hour) {
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function isFormalSession(session, now) { return session && session.mode !== 'practice' && session.day === dates.dayKey(now); }
Page({
  data: {
    completed: false,
    audioStatus: '',
    dateText: '',
    daysToExam: 0,
    remainingDueCount: 0,
    currentDueCount: 0,
    deferredRecoveryCount: 0,
    todayReviewDone: 0,
    todayReviewGoal: 0,
    estimatedMinutes: 0,
    greetingText: '',
    learned: 0,
    newCount: 0,
    progress: 0,
    sourceTag: '核心 day 1',
    total: 2522,
    todaySummary: null,
    resume: false,
    canAdd25: false,
    canAdd50: false,
    appVersion,
    syncText: '尚未开启云同步',
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 0 });
    this.refresh();
    if (this.stopSync) this.stopSync();
    this.stopSync = cloudSync.subscribe(status => {
      this.setData({ syncText: status.text });
      if (status.enabled) this.refresh();
    });
    clearInterval(this.audioTimer);
    this.setData({ audioStatus: audio.getStatus() });
    this.audioTimer = setInterval(() => this.setData({ audioStatus: audio.getStatus() }), 1000);
  },
  onHide() { clearInterval(this.audioTimer); if (this.stopSync) this.stopSync(); },
  onUnload() { clearInterval(this.audioTimer); if (this.stopSync) this.stopSync(); },
  openSync() { wx.switchTab({ url: '/pages/progress/index' }); },

  refresh() {
    const now = Date.now();
    const state = store.getState();
    const settings = store.getSettings();
    const session = store.getSession();
    if (plan.prepareSession(session, state, settings, now)) store.saveSession(session);
    const stats = plan.summarize(state, settings, now);
    const progress = plan.progressStats(state);
    const summary = store.getTodaySummary(state, now);
    const task = metrics.summary(state, session, dates.dayKey(now), stats);
    const time = timeLedger.summary(summary || {}, dates.dayKey(now));
    const estimate = metrics.estimate(state, isFormalSession(session, now) ? session : null,
      { review: task.reviewRemaining, new: task.newRemaining }, now);
    const isTodaySession = Boolean(session && session.day === dates.dayKey(now));
    const todayReviewDone = isTodaySession
      ? (session.dueDone || 0)
      : (summary && summary.dueDone || 0);
    const todayReviewGoal = isTodaySession
      ? Math.max(todayReviewDone, session.dueGoal || 0)
      : Math.max(todayReviewDone, (summary && summary.dueGoal) || todayReviewDone + stats.scheduledDue.length);
    const nextWord = stats.unseen[0];
    const todayNew = summary ? (summary.newGoal || summary.newDone || 0) : 0;
    const remainingCapacity = Math.max(0, (settings.dailyMaxNewCount || 100) - Math.max(settings.dailyNewCount, todayNew));
    this.setData({
      completed: Boolean(summary && summary.completedAt && !(session && session.day === dates.dayKey(now) && session.index < session.queue.length)),
      task, usedTime: timeLedger.format(time.seconds), remainingTime: task.remaining ? estimate.text : '已完成',
      futureReviewCount: Math.max(0, stats.remainingReviewCount - task.reviewRemaining),
      initialTime: summary && summary.initialEstimate ? metrics.range(summary.initialEstimate.seconds) : summary && summary.completedAt ? '旧版未记录' : estimate.text,
      initialLabel: summary && summary.initialEstimate ? (summary.initialEstimate.resumed ? '接续时预计' : '开始时预计') : '计划预计',
      dateText: dates.formatMonthDay(now),
      daysToExam: dates.daysUntil(settings.examDate, now),
      remainingDueCount: stats.remainingReviewCount,
      currentDueCount: stats.due.length,
      deferredRecoveryCount: stats.deferredRecoveryCount,
      todayReviewDone,
      todayReviewGoal,
      estimatedMinutes: stats.estimatedMinutes,
      greetingText: greeting(new Date(now).getHours()),
      learned: progress.learned,
      newCount: stats.newCount,
      progress: Math.round((progress.learned / progress.total) * 100),
      sourceTag: nextWord ? `${nextWord.category === 'core' ? '核心' : '高频'} day ${nextWord.day}` : '首轮已完成',
      total: progress.total,
      todaySummary: summary,
      resume: Boolean(session && session.day === dates.dayKey(now) && session.index < session.queue.length),
      canAdd25: Boolean(summary && summary.completedAt && remainingCapacity >= 25 && stats.unseen.length),
      canAdd50: Boolean(summary && summary.completedAt && remainingCapacity >= 50 && stats.unseen.length >= 50),
    });
  },

  async startStudy() {
    try { await require('../../utils/scheduler').prepare(); } catch (error) { wx.showToast({ title: '复习算法准备失败，联网后重试', icon: 'none' }); return; }
    if (!(await cloudSync.beginStudy())) return;
    const now = Date.now();
    const state = store.getState();
    const settings = store.getSettings();
    let session = store.getSession();
    if (require('../../utils/session-rollover').rollover(session, state, settings, now)) store.saveSession(session);
    if (plan.prepareSession(session, state, settings, now)) store.saveSession(session);
    if (!session || session.day !== dates.dayKey(now) || session.index >= session.queue.length) {
      session = plan.buildSession(state, settings, now);
      if (!session.queue.length) {
        wx.showToast({ title: '今天没有待学单词', icon: 'none' });
        return;
      }
      store.saveSession(session);
    }
    metrics.commit(state, session, now);
    state.daily[session.day].dueGoal = session.dueGoal;
    state.daily[session.day].newGoal = session.newGoal;
    store.saveState(state);
    wx.navigateTo({ url: '/pages/study/index' });
  },

  async startPractice() {
    if (!(await cloudSync.beginStudy())) return;
    const existing = store.getSession('practice');
    const options = [];
    if (existing && existing.index < existing.queue.length) options.push('继续上次主动复习');
    if (this.data.remainingDueCount) options.push('剩余待复习（最多 50 词）');
    options.push('最近学过的 50 词', '易忘词（最多 50 词）');
    wx.showActionSheet({ itemList: options, success: (result) => {
      const selected = options[result.tapIndex];
      if (selected !== '继续上次主动复习') {
        let scope = 'recent';
        if (selected.indexOf('剩余待复习') === 0) scope = 'due';
        if (selected.indexOf('易忘') === 0) scope = 'weak';
        const session = practice.buildSession(store.getState(), { scope });
        if (!session.queue.length) {
          wx.showToast({ title: '这个范围还没有已学词', icon: 'none' });
          return;
        }
        store.saveSession(session);
      }
      wx.navigateTo({ url: '/pages/study/index?mode=practice' });
    } });
  },

  async addExtraStudy(event) {
    try { await require('../../utils/scheduler').prepare(); } catch (error) { wx.showToast({ title: '复习算法准备失败，联网后重试', icon: 'none' }); return; }
    if (!(await cloudSync.beginStudy())) return;
    const amount = Number(event.currentTarget.dataset.amount) || 25;
    const now = Date.now();
    const state = store.getState();
    const settings = store.getSettings();
    const session = plan.buildExtraSession(state, settings, amount, now);
    if (!session || !session.queue.length) {
      wx.showToast({ title: '今天已达到上限', icon: 'none' });
      return;
    }
    const previous = state.daily[session.day] || {};
    state.daily[session.day] = Object.assign({}, previous, {
      completedAt: 0,
      extraNew: session.extraNew,
      newGoal: session.newGoal,
    });
    metrics.commit(state, session, now);
    store.saveState(state);
    store.saveSession(session);
    wx.navigateTo({ url: '/pages/study/index' });
  },
});
