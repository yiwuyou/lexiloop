const context = require('../../utils/context');
const { DAY_MS } = require('../../utils/date');
const scheduler = require('../../utils/scheduler');
const store = require('../../utils/store');
const { getWord } = require('../../utils/words');

const PHASE_LABELS = {
  review: '到期复习',
  new: '新词建联',
  reinforcement: '难词强化',
  context: '延迟抽测',
};

Page({
  data: {
    completed: false,
    contextAnswered: false,
    contextCorrect: false,
    current: 1,
    currentInPhase: 1,
    isContext: false,
    phaseLabel: '',
    phaseTotal: 1,
    progress: 0,
    question: null,
    revealed: false,
    selectedChoice: -1,
    sessionSummary: null,
    total: 1,
    word: null,
  },

  onLoad() {
    this.audio = wx.createInnerAudioContext();
    this.audio.obeyMuteSwitch = false;
    this.audioPlaying = false;
    this.audioStarted = false;
    this.audio.onPlay(() => {
      this.audioPlaying = true;
      this.audioStarted = true;
    });
    this.audio.onEnded(() => { this.audioPlaying = false; });
    this.audio.onStop(() => { this.audioPlaying = false; });
    this.audio.onError((error) => {
      console.error('pronunciation audio error', error);
      this.audioPlaying = false;
      if (!this.audioStarted) wx.showToast({ title: '发音播放失败', icon: 'none' });
    });
    this.session = store.getSession();
    if (!this.session || !this.session.queue || !this.session.queue.length) {
      wx.reLaunch({ url: '/pages/today/index' });
      return;
    }
    this.activeStartedAt = Date.now();
    this.renderCurrent();
  },

  onShow() {
    this.activeStartedAt = Date.now();
  },

  onHide() {
    this.captureElapsed();
    if (this.session) store.saveSession(this.session);
  },

  onUnload() {
    this.captureElapsed();
    if (this.session && !this.data.completed) store.saveSession(this.session);
    if (this.audio) this.audio.destroy();
  },

  captureElapsed() {
    if (!this.activeStartedAt || !this.session) return;
    const seconds = Math.max(0, Math.round((Date.now() - this.activeStartedAt) / 1000));
    this.session.elapsedSeconds = (this.session.elapsedSeconds || 0) + seconds;
    this.activeStartedAt = Date.now();
  },

  writeDailyProgress(state, completedAt) {
    const previous = state.daily[this.session.day] || {};
    state.daily[this.session.day] = Object.assign({}, previous, {
      completedAt: completedAt || previous.completedAt || 0,
      contextCorrect: this.session.contextCorrect,
      contextDone: this.session.contextDone,
      dueDone: this.session.dueDone,
      dueGoal: this.session.dueGoal,
      minutes: Math.max(1, Math.round((this.session.elapsedSeconds || 0) / 60)),
      newDone: this.session.newDone,
      newGoal: this.session.newGoal,
      ratings: this.session.ratings,
      reinforcementDone: this.session.reinforcementDone,
      extraNew: this.session.extraNew || 0,
    });
    return state.daily[this.session.day];
  },

  currentItem() {
    return this.session.queue[this.session.index] || null;
  },

  renderCurrent() {
    if (this.session.index >= this.session.queue.length) {
      this.finishSession();
      return;
    }
    const item = this.currentItem();
    const word = getWord(item.wordId);
    if (!word) {
      this.session.index += 1;
      this.renderCurrent();
      return;
    }
    const samePhaseBefore = this.session.queue
      .slice(0, this.session.index + 1)
      .filter((candidate) => candidate.phase === item.phase).length;
    const phaseTotal = this.session.queue.filter((candidate) => candidate.phase === item.phase).length;
    const question = item.phase === 'context' ? context.getById(item.questionId) : null;
    this.setData({
      contextAnswered: false,
      contextCorrect: false,
      current: this.session.index + 1,
      currentInPhase: samePhaseBefore,
      isContext: item.phase === 'context',
      phaseLabel: PHASE_LABELS[item.phase] || '单词学习',
      phaseTotal,
      progress: Math.round(((this.session.index + 1) / this.session.queue.length) * 100),
      question,
      revealed: false,
      selectedChoice: -1,
      total: this.session.queue.length,
      word,
    });
  },

  revealAnswer() {
    this.setData({ revealed: true });
  },

  playPronunciation() {
    if (!this.data.word || !this.data.word.audio || !this.audio) return;
    if (this.audioPlaying) this.audio.stop();
    this.audioStarted = false;
    this.audio.src = this.data.word.audio;
    this.audio.play();
  },

  rate(event) {
    const grade = event.currentTarget.dataset.grade;
    if (!['again', 'hard', 'good', 'easy'].includes(grade)) return;
    const item = this.currentItem();
    const word = getWord(item.wordId);
    const now = Date.now();
    const state = store.getState();
    const previous = state.cards[word.id];
    state.cards[word.id] = scheduler.review(previous, grade, now);
    store.appendReview(state, {
      at: now,
      day: this.session.day,
      wordId: word.id,
      phase: item.phase,
      result: grade,
    });

    if (item.phase === 'review') this.session.dueDone += 1;
    if (item.phase === 'new') this.session.newDone += 1;
    if (item.phase === 'reinforcement') this.session.reinforcementDone += 1;
    this.session.ratings[grade] = (this.session.ratings[grade] || 0) + 1;

    if ((grade === 'again' || grade === 'hard') && !item.reinforced) {
      const alreadyQueued = this.session.queue
        .slice(this.session.index + 1)
        .some((candidate) => candidate.wordId === word.id && candidate.phase === 'reinforcement');
      if (!alreadyQueued) {
        const insertAt = Math.min(this.session.queue.length, this.session.index + 9);
        this.session.queue.splice(insertAt, 0, {
          wordId: word.id,
          phase: 'reinforcement',
          reinforced: true,
        });
      }
    }

    this.captureElapsed();
    this.session.index += 1;
    this.writeDailyProgress(state);
    store.saveState(state);
    store.saveSession(this.session);
    this.renderCurrent();
  },

  chooseContext(event) {
    if (this.data.contextAnswered) return;
    const index = Number(event.currentTarget.dataset.index);
    const question = this.data.question;
    const correct = index === question.answer;
    const now = Date.now();
    const item = this.currentItem();
    const state = store.getState();
    const card = state.cards[item.wordId];
    if (!correct && card) {
      card.dueAt = Math.min(card.dueAt || now + DAY_MS, now + DAY_MS);
      card.lastGrade = 'hard';
      state.cards[item.wordId] = card;
    }
    store.appendReview(state, {
      at: now,
      day: this.session.day,
      wordId: item.wordId,
      phase: 'context',
      result: correct ? 'correct' : 'wrong',
    });
    store.saveState(state);
    this.setData({
      contextAnswered: true,
      contextCorrect: correct,
      selectedChoice: index,
    });
  },

  nextContext() {
    if (!this.data.contextAnswered) return;
    this.session.contextDone += 1;
    if (this.data.contextCorrect) this.session.contextCorrect += 1;
    this.captureElapsed();
    this.session.index += 1;
    const state = store.getState();
    this.writeDailyProgress(state);
    store.saveState(state);
    store.saveSession(this.session);
    this.renderCurrent();
  },

  finishSession() {
    this.captureElapsed();
    const now = Date.now();
    const state = store.getState();
    const minutes = Math.max(1, Math.round((this.session.elapsedSeconds || 0) / 60));
    const summary = this.writeDailyProgress(state, now);
    summary.minutes = minutes;
    store.saveState(state);
    store.clearSession();
    this.setData({ completed: true, sessionSummary: summary });
  },

  exitStudy() {
    this.captureElapsed();
    if (this.session && !this.data.completed) {
      const state = store.getState();
      this.writeDailyProgress(state);
      store.saveState(state);
      store.saveSession(this.session);
    }
    wx.reLaunch({ url: '/pages/today/index' });
  },
});
