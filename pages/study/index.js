const context = require('../../utils/context');
const mastery = require('../../utils/mastery');
const { DAY_MS, dayKey, startOfDay } = require('../../utils/date');
const scheduler = require('../../utils/scheduler');
const store = require('../../utils/store');
const practice = require('../../utils/practice');
const audioResources = require('../../utils/audio');
const { getWord } = require('../../utils/words');
const weakBook = require('../../utils/weak-book');

const PHASE_LABELS = {
  review: '到期复习',
  new: '新词建联',
  reinforcement: '难词强化',
  context: '延迟抽测',
  practice: '主动复习',
};

Page({
  data: {
    completed: false,
    isPractice: false,
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
    audioLoading: false,
    waiting: false,
    waitSeconds: 0,
    pendingCount: 0,
    contentScrollTop: 0,
    contentHeight: 0,
    isWeakMarked: false,
  },

  onLoad(options = {}) {
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
    this.setData({ isPractice: options.mode === 'practice' });
    this.session = store.getSession(options.mode);
    if (!this.session || !this.session.queue || !this.session.queue.length) {
      wx.reLaunch({ url: '/pages/today/index' });
      return;
    }
    if (!this.data.isPractice && !this.session.masteryVersion) {
      const state = store.getState();
      this.session.queue.slice(0, this.session.index).forEach(item => {
        const card = state.cards[item.wordId];
        if (card && ['again', 'hard'].includes(card.lastGrade)) card.needsRecall = true;
      });
      this.session.masteryVersion = 1;
      store.saveState(state);
      store.saveSession(this.session);
    }
    this.activeStartedAt = Date.now();
    this.renderCurrent();
  },

  onShow() {
    this.activeStartedAt = Date.now();
    if (this.session && !this.data.completed) this.renderCurrent();
  },

  onHide() {
    clearTimeout(this.waitTimer);
    this.setData({ audioLoading: false });
    this.audioRequest = (this.audioRequest || 0) + 1;
    if (this.audioPlaying && this.audio) this.audio.stop();
    this.captureElapsed();
    this.activeStartedAt = 0;
    if (this.session && !this.data.completed) store.saveSession(this.session);
  },

  onUnload() {
    clearTimeout(this.waitTimer);
    this.audioRequest = (this.audioRequest || 0) + 1;
    this.captureElapsed();
    if (this.session && !this.data.completed) store.saveSession(this.session);
    if (this.audio) this.audio.destroy();
    this.audio = null;
  },

  captureElapsed() {
    if (!this.activeStartedAt || !this.session) return;
    const seconds = Math.max(0, Math.round((Date.now() - this.activeStartedAt) / 1000));
    this.session.elapsedSeconds = (this.session.elapsedSeconds || 0) + seconds;
    this.activeStartedAt = Date.now();
  },

  writeDailyProgress(state, completedAt) {
    if (this.data.isPractice) return null;
    const previous = state.daily[this.session.day] || {};
    state.daily[this.session.day] = Object.assign({}, previous, {
      completedAt: completedAt || 0,
      pendingCount: mastery.remaining(this.session, state.cards).length,
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
    clearTimeout(this.waitTimer);
    this.audioRequest = (this.audioRequest || 0) + 1;
    if (this.audioPlaying && this.audio) this.audio.stop();
    if (this.session.index >= this.session.queue.length) {
      if (!this.data.isPractice) mastery.recover(this.session, store.getState().cards);
    }
    if (this.session.index >= this.session.queue.length) {
      this.finishSession();
      return;
    }
    if (!mastery.available(this.session, Date.now())) {
      const waitSeconds = Math.max(1, Math.ceil((this.currentItem().availableAt - Date.now()) / 1000));
      this.setData({ waiting: true, waitSeconds });
      store.saveSession(this.session);
      this.waitTimer = setTimeout(() => this.renderCurrent(), 1000);
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
    let question = item.phase === 'context' ? context.getById(item.questionId) : null;
    if (question && item.retry) {
      const shift = item.retry % question.choices.length;
      question = Object.assign({}, question, { choices: question.choices.slice(shift).concat(question.choices.slice(0, shift)),
        answer: (question.answer - shift + question.choices.length) % question.choices.length });
    }
    const state = store.getState();
    this.setData({
      waiting: false,
      contentScrollTop: this.data.contentScrollTop === 0 ? 1 : 0,
      contentHeight: 0,
      pendingCount: this.data.isPractice ? 0 : mastery.remaining(this.session, state.cards).length,
      contextAnswered: Boolean(item.answered),
      audioLoading: false,
      contextCorrect: Boolean(item.correct),
      current: this.session.index + 1,
      currentInPhase: samePhaseBefore,
      isContext: item.phase === 'context',
      phaseLabel: PHASE_LABELS[item.phase] || '单词学习',
      phaseTotal,
      progress: Math.round(((this.session.index + 1) / this.session.queue.length) * 100),
      question,
      revealed: false,
      selectedChoice: item.selectedChoice == null ? -1 : item.selectedChoice,
      total: this.session.queue.length,
      word,
      isWeakMarked: weakBook.isMarked(state, word.id),
    });
  },

  revealAnswer() {
    this.setData({ revealed: true, contentHeight: 0 }, () => this.fitAnswerContent());
  },
  fitAnswerContent() {
    if (!this.data.revealed || this.data.isContext || this.data.completed || typeof wx.createSelectorQuery !== 'function') return;
    const wordId = this.data.word.id;
    const measure = () => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.study-content').boundingClientRect();
      query.select('.word-card').boundingClientRect();
      query.exec(rects => {
        if (!rects[0] || !rects[1] || !this.data.revealed || this.data.word.id !== wordId) return;
        this.setData({ contentHeight: Math.max(1, Math.ceil(Math.min(rects[0].height, rects[1].height))) });
      });
    };
    if (wx.nextTick) wx.nextTick(measure); else measure();
  },
  onResize() {
    this.setData({ contentHeight: 0 }, () => this.fitAnswerContent());
  },

  async playPronunciation() {
    if (!this.data.word || !this.data.word.audio || !this.audio) return;
    const request = this.audioRequest = (this.audioRequest || 0) + 1;
    this.setData({ audioLoading: true });
    try {
    const source = await audioResources.sourceFor(this.data.word);
    if (request !== this.audioRequest || !this.audio) return;
    if (this.audioPlaying) this.audio.stop();
    this.audioStarted = false;
    this.audio.src = source;
    this.audio.play();
    } catch (error) {
      if (request === this.audioRequest) wx.showModal({ title: '发音准备失败', content: audioResources.describeError(error) + '。无需先下载全部语音，可联网后直接点播放重试。', showCancel: false });
    } finally {
      if (request === this.audioRequest) this.setData({ audioLoading: false });
    }
  },

  showExampleSource() {
    if (this.data.word) wx.showModal({ title: '例句来源与说明', content: this.data.word.exampleSourceDetail, showCancel: false });
  },

  rate(event) {
    if (!this.data.revealed || this.data.completed || this.ratingBusy) return;
    const grade = event.currentTarget.dataset.grade;
    if (!['again', 'hard', 'good', 'easy'].includes(grade)) return;
    this.ratingBusy = true;
    try {
    if (this.data.isPractice) {
      const state = store.getState();
      practice.recordAnswer(state, this.session, grade);
      this.captureElapsed();
      store.saveState(state);
      store.saveSession(this.session);
      this.renderCurrent();
      return;
    }
    const item = this.currentItem();
    const word = getWord(item.wordId);
    const now = Date.now();
    const state = store.getState();
    const previous = state.cards[word.id];
    state.cards[word.id] = scheduler.review(previous, grade, now);
    if (weakBook.shouldAutoMark(state.cards[word.id], grade)) weakBook.mark(state, word.id, 'formal', now);
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

    if (grade === 'again' || grade === 'hard') {
      const alreadyQueued = this.session.queue
        .slice(this.session.index + 1)
        .some((candidate) => candidate.wordId === word.id && candidate.phase === 'reinforcement');
      if (!alreadyQueued) {
        mastery.retry(this.session, item, now);
      }
    }

    this.captureElapsed();
    this.session.index += 1;
    this.writeDailyProgress(state);
    store.saveState(state);
    store.saveSession(this.session);
    this.renderCurrent();
    } finally {
      this.ratingBusy = false;
    }
  },

  toggleWeak() {
    if (!this.data.word) return;
    const state = store.getState();
    const marked = weakBook.toggle(state, this.data.word.id, Date.now());
    store.saveState(state);
    this.setData({ isWeakMarked: marked });
    wx.showToast({ title: marked ? '已加入易忘' : '已移出易忘', icon: 'none' });
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
      card.dueAt = Math.min(card.dueAt || now + DAY_MS, startOfDay(now) + DAY_MS);
      card.failedDay = dayKey(now);
      card.lastGrade = 'hard';
      card.interval = Math.min(card.interval || 1, 1);
      card.needsContext = item.questionId;
      state.cards[item.wordId] = card;
      weakBook.mark(state, item.wordId, 'context', now);
    }
    if (correct && card) card.needsContext = '';
    if (!correct) mastery.retry(this.session, item, now);
    store.appendReview(state, {
      at: now,
      day: this.session.day,
      wordId: item.wordId,
      phase: 'context',
      result: correct ? 'correct' : 'wrong',
    });
    store.saveState(state);
    // Save the answered state before leaving the explanation screen.
    item.answered = true;
    item.correct = correct;
    item.selectedChoice = index;
    store.saveSession(this.session);
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
    if (this.data.isPractice) {
      store.clearSession('practice');
      this.setData({ completed: true, sessionSummary: {
        minutes, practiceDone: this.session.answers.length,
        remembered: this.session.ratings.good + this.session.ratings.easy,
      } });
      return;
    }
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
