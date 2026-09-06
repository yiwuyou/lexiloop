const dates = require('../../utils/date');
const plan = require('../../utils/study-plan');
const store = require('../../utils/store');
const practice = require('../../utils/practice');

function greeting(hour) {
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

Page({
  data: {
    completed: false,
    dateText: '',
    daysToExam: 0,
    dueCount: 0,
    estimatedMinutes: 0,
    greetingText: '',
    learned: 0,
    newCount: 0,
    overdueCount: 0,
    progress: 0,
    sourceTag: '核心 day 1',
    total: 2522,
    todaySummary: null,
    resume: false,
    canAdd25: false,
    canAdd50: false,
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 0 });
    this.refresh();
  },

  refresh() {
    const now = Date.now();
    const state = store.getState();
    const settings = store.getSettings();
    const stats = plan.summarize(state, settings, now);
    const progress = plan.progressStats(state);
    const session = store.getSession();
    const summary = store.getTodaySummary(state, now);
    const nextWord = stats.unseen[0];
    const todayNew = summary ? (summary.newGoal || summary.newDone || 0) : 0;
    const remainingCapacity = Math.max(0, (settings.dailyMaxNewCount || 100) - Math.max(settings.dailyNewCount, todayNew));
    this.setData({
      completed: Boolean(summary && summary.completedAt),
      dateText: dates.formatMonthDay(now),
      daysToExam: dates.daysUntil(settings.examDate, now),
      dueCount: stats.due.length,
      estimatedMinutes: stats.estimatedMinutes,
      greetingText: greeting(new Date(now).getHours()),
      learned: progress.learned,
      newCount: stats.newCount,
      overdueCount: stats.overdue.length,
      progress: Math.round((progress.learned / progress.total) * 100),
      sourceTag: nextWord ? `${nextWord.category === 'core' ? '核心' : '高频'} day ${nextWord.day}` : '首轮已完成',
      total: progress.total,
      todaySummary: summary,
      resume: Boolean(session && session.day === dates.dayKey(now) && session.index < session.queue.length),
      canAdd25: Boolean(summary && summary.completedAt && remainingCapacity >= 25 && stats.unseen.length),
      canAdd50: Boolean(summary && summary.completedAt && remainingCapacity >= 50 && stats.unseen.length >= 50),
    });
  },

  startStudy() {
    const now = Date.now();
    let session = store.getSession();
    if (!session || session.day !== dates.dayKey(now) || session.index >= session.queue.length) {
      const state = store.getState();
      const settings = store.getSettings();
      session = plan.buildSession(state, settings, now);
      if (!session.queue.length) {
        wx.showToast({ title: '今天没有待学单词', icon: 'none' });
        return;
      }
      store.saveSession(session);
    }
    wx.navigateTo({ url: '/pages/study/index' });
  },

  startPractice() {
    const existing = store.getSession('practice');
    const options = existing && existing.index < existing.queue.length
      ? ['继续上次主动复习', '最近学过的 50 词', '易忘词（最多 50 词）']
      : ['最近学过的 50 词', '易忘词（最多 50 词）'];
    wx.showActionSheet({ itemList: options, success: (result) => {
      const selected = options[result.tapIndex];
      if (selected !== '继续上次主动复习') {
        const session = practice.buildSession(store.getState(), { scope: selected.indexOf('易忘') === 0 ? 'weak' : 'recent' });
        if (!session.queue.length) {
          wx.showToast({ title: '这个范围还没有已学词', icon: 'none' });
          return;
        }
        store.saveSession(session);
      }
      wx.navigateTo({ url: '/pages/study/index?mode=practice' });
    } });
  },

  addExtraStudy(event) {
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
    store.saveState(state);
    store.saveSession(session);
    wx.navigateTo({ url: '/pages/study/index' });
  },
});
