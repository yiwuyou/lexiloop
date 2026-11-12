const context = require('../../utils/context');
const mastery = require('../../utils/mastery');
const studyOrder = require('../../utils/study-order');
const { DAY_MS, dayKey, startOfDay } = require('../../utils/date');
const scheduler = require('../../utils/scheduler');
const store = require('../../utils/store');
const practice = require('../../utils/practice');
const audioResources = require('../../utils/audio');
const phraseResources = require('../../utils/phrases');
const studyPlan = require('../../utils/study-plan');
const { getWord } = require('../../utils/words');
const weakBook = require('../../utils/weak-book');
const sentenceBook = require('../../utils/sentence-book');
const sentenceTap = require('../../utils/sentence-tap');
const cloudSync = require('../../utils/cloud-sync');
const metrics = require('../../utils/learning-metrics');
const clock = require('../../utils/learning-clock');
const timeLedger = require('../../utils/time-ledger');
const trace = require('../../utils/interaction-trace');

const PHASE_LABELS = {
  review: '旧词复习',
  new: '新词学习',
  reinforcement: '难词强化',
  context: '延迟抽测',
  sentence: '例句巩固',
  practice: '主动复习',
};

Page({
  copyWord: require('../../utils/copy-word'),
  sentenceTouchStart: sentenceTap.start,
  sentenceTouchMove: sentenceTap.move,
  sentenceTouchEnd: sentenceTap.end,
  sentenceTouchCancel: sentenceTap.cancel,
  tapSentence: sentenceTap.tap,
  data: {
    completed: false,
    isPractice: false,
    contextAnswered: false,
    contextCorrect: false,
    questionLabel: '',
    questionPrompt: '',
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
    isSentenceSaved: false,
    relationsOpen: false,
    relationWordId: '',
    syncBlocked: false,
    taskLabel: '', taskVerb: '', taskPending: 0, taskDone: 0, taskTotal: 0, stageDetail: '', usedTime: '0分钟', remainingTime: '',
  },

  onLoad(options = {}) {
    try { this.loadStudy(options); } catch (error) { this.openReadFailure(); }
  },
  openReadFailure() {
    wx.showToast({ title: '读取学习记录未完成，请在首页重试', icon: 'none' });
    wx.switchTab({ url: '/pages/today/index' });
  },
  loadStudy(options = {}) {
    scheduler.prepare().catch(() => {});
    this.audio = require('../../utils/audio-options').create();
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
    const state = store.getState();
    if (!this.data.isPractice) {
      const settings = store.getSettings(), now = Date.now();
      let stateChanged = !cloudSync.blocked() && studyPlan.repairSessionPlan(this.session, state, settings, now);
      let sessionChanged = studyPlan.prepareSession(this.session, state, settings, now) || stateChanged;
      if (!this.session.masteryVersion) {
        this.session.queue.slice(0, this.session.index).forEach(item => {
          const card = state.cards[item.wordId];
          if (card && !card.needsRecall && ['again', 'hard'].includes(card.lastGrade)) {
            card.needsRecall = true;
            stateChanged = true;
          }
        });
        this.session.masteryVersion = 1;
        sessionChanged = true;
      }
      if (stateChanged) store.saveState(state);
      if (sessionChanged) store.saveSession(this.session);
    }
    this.renderCurrent(state);
  },

  onShow() {
    try { this.resumeStudyScreen(); } catch (error) { this.openReadFailure(); }
  },
  resumeStudyScreen() {
    this.libraryOpening = false;
    this.studyHidden = false;
    if (this.session && !this.data.completed) {
      const state = store.getState();
      const now = Date.now();
      if (!this.data.isPractice && this.session.day !== timeLedger.dayKey(now)
          && studyPlan.rolloverSession(this.session, state, store.getSettings(), now)) {
        this.detailReturn = null;
        store.saveState(state);
        store.saveSession(this.session);
      }
      if (this.detailReturn) {
        const snapshot = this.detailReturn;
        this.detailReturn = null;
        this.setData(Object.assign(snapshot, { isWeakMarked: weakBook.isMarked(state, this.data.word.id), isSentenceSaved: sentenceBook.has(state, this.data.word.example) }));
      } else this.renderCurrent(state);
    }
    if (this.stopSync) this.stopSync();
    if (this.stopClock) this.stopClock();
    this.stopClock = clock.subscribe(time => this.setData({ usedTime: timeLedger.format(time.seconds) }));
    if (this.session && !this.data.completed) clock.enter(this.currentItem().phase);
    this.stopSync = cloudSync.subscribe(() => { const blocked = cloudSync.blocked(); if (blocked !== this.data.syncBlocked) this.setData({ syncBlocked: blocked }); });
  },

  async takeOverStudy() {
    if (!(await cloudSync.beginStudy())) return;
    this.session = store.getSession(this.data.isPractice ? 'practice' : undefined);
    if (!this.session) { wx.reLaunch({ url: '/pages/today/index' }); return; }
    this.setData({ syncBlocked: false, completed: false });
    const state = store.getState();
    if (!this.data.isPractice) {
      const settings = store.getSettings(), now = Date.now();
      if (studyPlan.repairSessionPlan(this.session, state, settings, now)) {
        studyPlan.prepareSession(this.session, state, settings, now);
        store.saveState(state);
        store.saveSession(this.session);
      }
    }
    this.renderCurrent(state);
  },

  onHide() {
    if (this.stopSync) this.stopSync();
    clearTimeout(this.waitTimer);
    clearTimeout(this.contentLayoutTimer);
    this.contentRenderVersion = (this.contentRenderVersion || 0) + 1;
    this.setData({ audioLoading: false, relationsOpen: false });
    this.audioRequest = (this.audioRequest || 0) + 1;
    if (this.audioPlaying && this.audio) this.audio.stop();
    this.pauseStudyPage();
  },

  onUnload() {
    if (this.stopSync) this.stopSync();
    clearTimeout(this.waitTimer);
    clearTimeout(this.contentLayoutTimer);
    this.contentRenderVersion = (this.contentRenderVersion || 0) + 1;
    this.audioRequest = (this.audioRequest || 0) + 1;
    this.pauseStudyPage();
    if (this.audio) this.audio.destroy();
    this.audio = null;
  },

  pauseStudyPage() {
    if (this.studyHidden) return;
    clock.pause('study');
    if (this.stopClock) this.stopClock();
    try {
      if (this.session && !this.data.completed && !cloudSync.blocked()) {
        const state = store.getState();
        this.captureElapsed(state);
        store.saveAnswer(state, this.session, []);
      }
    } catch (error) {
      wx.showToast({ title: '记录保存未完成，请保留缓存', icon: 'none' });
    } finally { this.studyHidden = true; }
  },

  captureElapsed(state) {
    if (this.session) this.session.elapsedSeconds = timeLedger.summary(state.daily[this.session.day] || {}, this.session.day).seconds;
  },
  onLearningTouch() {
    const started = Date.now();
    const item = this.session && this.currentItem();
    if (item && item.phase && !this.data.completed) clock.touch(item.phase);
    if (Date.now()-started >= 10) trace.record('touch.prepare', started);
  },

  writeDailyProgress(state, completedAt) {
    if (this.data.isPractice) return null;
    metrics.commit(state, this.session);
    const previous = state.daily[this.session.day] || {};
    state.daily[this.session.day] = Object.assign({}, previous, {
      completedAt: completedAt || 0,
      pendingCount: mastery.remaining(this.session, state.cards).length,
      contextCorrect: this.session.contextCorrect,
      contextDone: this.session.contextDone,
      sentenceCorrect: this.session.sentenceCorrect || 0,
      sentenceDone: this.session.sentenceDone || 0,
      dueDone: this.session.dueDone,
      backlogDone: this.session.backlogDone || 0,
      dueGoal: this.session.dueGoal,
      minutes: Math.floor(timeLedger.summary(state.daily[this.session.day], this.session.day).seconds / 60),
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
  rollToToday() {
    const now = Date.now();
    if (this.data.isPractice || !this.session || this.session.day === timeLedger.dayKey(now)) return false;
    const state = store.getState();
    if (!studyPlan.rolloverSession(this.session, state, store.getSettings(), now)) return false;
    store.saveState(state); store.saveSession(this.session); this.renderCurrent(state);
    return true;
  },

  openLibrary() {
    if (this.libraryOpening || this.data.completed || !this.data.word) return;
    this.libraryOpening = true;
    this.detailReturn = {
      relationsOpen: false,
      revealed: this.data.revealed,
      contextAnswered: this.data.contextAnswered,
      contentScrollTop: this.data.contentScrollTop,
    };
    wx.navigateTo({
      url: '/word-detail/search',
      fail: () => {
        this.libraryOpening = false;
        this.detailReturn = null;
        wx.showToast({ title: '暂时无法打开词库，请重试', icon: 'none' });
      },
    });
  },

  openRelations() {
    if (this.data.isContext ? !this.data.contextAnswered : !this.data.revealed) return;
    this.setData({ relationWordId: this.data.word.id, relationsOpen: true });
  },
  openWordDetail(event) {
    const id = event.detail.wordId;
    if (!getWord(id)) return;
    this.detailReturn = { relationsOpen: true, revealed: this.data.revealed, contextAnswered: this.data.contextAnswered, contentScrollTop: this.data.contentScrollTop };
    wx.navigateTo({ url: '/word-detail/index?id=' + encodeURIComponent(id), fail: () => { this.detailReturn = null; } });
  },
  closeRelations() { this.setData({ relationsOpen: false }); },

  renderCurrent(currentState, timing) {
    clearTimeout(this.waitTimer);
    clearTimeout(this.contentLayoutTimer);
    const renderVersion = this.contentRenderVersion = (this.contentRenderVersion || 0) + 1;
    this.contentTouchActive = false;
    this.pendingPhrase = null;
    this.pendingContentHeight = null;
    this.audioRequest = (this.audioRequest || 0) + 1;
    if (this.audioPlaying && this.audio) this.audio.stop();
    const state = currentState || store.getState();
    if (this.session.index >= this.session.queue.length && !this.data.isPractice) mastery.recover(this.session, state.cards);
    mastery.available(this.session, Date.now());
    if (!this.data.isPractice && studyOrder.reconcile(this.session, state) && !cloudSync.blocked()) store.saveAnswer(state, this.session, []);
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
    const wordPlan = this.data.isPractice ? {} : metrics.planFor(state, this.session, this.session.day);
    const kind = this.data.isPractice ? 'practice' : studyOrder.kindOf(item, wordPlan, state);
    const inPhase = candidate => candidate.phase === item.phase && (this.data.isPractice || studyOrder.kindOf(candidate, wordPlan, state) === kind);
    const samePhaseBefore = this.session.queue.slice(0, this.session.index + 1).filter(inPhase).length;
    const phaseTotal = this.session.queue.filter(inPhase).length;
    const isQuestion = item.phase === 'context' || item.phase === 'sentence';
    let question = isQuestion ? context.getById(item.questionId) : null;
    if (question && item.retry) {
      const shift = item.retry % question.choices.length;
      question = Object.assign({}, question, { choices: question.choices.slice(shift).concat(question.choices.slice(0, shift)),
        answer: (question.answer - shift + question.choices.length) % question.choices.length });
    }
    const task = this.data.isPractice ? { done: this.session.index, total: this.session.queue.length,
      percent: Math.round(this.session.index / this.session.queue.length * 100) } : metrics.summary(state, this.session, this.session.day);
    const active = this.data.isPractice ? Object.assign({ label: '主动复习', verb: '已练习', pending: 0 }, task) : metrics.section(task, kind);
    const remainingPhase = new Set(this.session.queue.slice(this.session.index).filter(inPhase).map(r => r.wordId)).size;
    const stageDetail = isQuestion ? `第${samePhaseBefore}/${phaseTotal}题（含重练）`
      : item.phase === 'reinforcement' ? `还有${remainingPhase}词待回忆` : this.data.isPractice ? '单独统计，不抵扣今日任务' : active.pending ? `另有${active.pending}词待巩固` : '';
    clock.enter(item.phase);
    this.setData({
      waiting: false,
      relationsOpen: false,
      contentScrollTop: this.data.contentScrollTop === 0 ? 1 : 0,
      contentHeight: 0,
      pendingCount: this.data.isPractice ? 0 : mastery.remaining(this.session, state.cards).length,
      contextAnswered: Boolean(item.answered),
      audioLoading: false,
      contextCorrect: Boolean(item.correct),
      current: this.session.index + 1,
      currentInPhase: samePhaseBefore,
      taskLabel: active.label, taskVerb: active.verb, taskPending: active.pending, taskDone: active.done, taskTotal: active.total, stageDetail,
      usedTime: timeLedger.format(timeLedger.summary(state.daily[timeLedger.dayKey(Date.now())] || {}, timeLedger.dayKey(Date.now())).seconds),
      isContext: isQuestion,
      questionLabel: item.phase === 'sentence' ? '例句巩固' : '语境辨义',
      questionPrompt: item.phase === 'sentence'
        ? (word.exampleSense ? '结合句子，这个单词在本句中表示：' : '结合句子回忆，这个单词的主要义是：')
        : '这里的词义是：',
      phaseLabel: PHASE_LABELS[item.phase] || '单词学习',
      phaseTotal,
      progress: active.percent,
      question,
      showQuestionExplanation: item.phase !== 'sentence' || Boolean(word.exampleSense),
      revealed: false,
      selectedChoice: item.selectedChoice == null ? -1 : item.selectedChoice,
      total: this.session.queue.length,
      word,
      isWeakMarked: weakBook.isMarked(state, word.id),
      isSentenceSaved: sentenceBook.has(state, question ? question.sentence : word.example),
    }, () => { if (timing) { timing.mark('viewCallback'); timing.finish(); } });
    if (!isQuestion) {
      phraseResources.phraseFor(word).then((phrase) => {
        this.applyPhrase(phrase, word.id, renderVersion);
      }).catch(() => {});
    }
  },

  revealAnswer() {
    const timing = trace.begin('reveal');
    this.setData({ revealed: true, contentHeight: 0 }, () => { timing.mark('viewCallback'); timing.finish(); this.fitAnswerContent(); });
  },
  applyPhrase(phrase, wordId, version) {
    if (!phrase || version !== this.contentRenderVersion || !this.data.word || this.data.word.id !== wordId) return;
    if (this.contentTouchActive) { this.pendingPhrase = { phrase, wordId, version }; return; }
    // Keep the already measured scroll viewport stable. Extra content can
    // scroll inside it; resetting flex/height here moved the first save target.
    this.setData({ 'word.phrase': phrase });
  },
  onContentTouchStart() {
    this.onLearningTouch();
    this.contentTouchActive = true;
    clearTimeout(this.contentLayoutTimer);
  },
  onContentTouchEnd() {
    this.contentTouchActive = false;
    clearTimeout(this.contentLayoutTimer);
    this.contentLayoutTimer = setTimeout(() => this.flushContentUpdates(), 60);
  },
  flushContentUpdates() {
    if (this.contentTouchActive) return;
    const phrase = this.pendingPhrase;
    const height = this.pendingContentHeight;
    this.pendingPhrase = null;
    this.pendingContentHeight = null;
    if (phrase) this.applyPhrase(phrase.phrase, phrase.wordId, phrase.version);
    if (height && height.version === this.contentRenderVersion && this.data.revealed && !this.data.completed) {
      this.setData({ contentHeight: height.value });
    }
  },
  fitAnswerContent() {
    if (!this.data.revealed || this.data.isContext || this.data.completed || typeof wx.createSelectorQuery !== 'function') return;
    const wordId = this.data.word.id;
    const version = this.contentRenderVersion;
    const measure = () => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.study-content').boundingClientRect();
      query.select('.study-word-card').boundingClientRect();
      query.exec(rects => {
        if (!rects[0] || !rects[1] || rects[0].height <= 0 || rects[1].height <= 0 || !this.data.revealed || this.data.word.id !== wordId || version !== this.contentRenderVersion) return;
        const value = Math.max(1, Math.ceil(Math.min(rects[0].height, rects[1].height)));
        if (this.contentTouchActive) this.pendingContentHeight = { value, version };
        else this.setData({ contentHeight: value });
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

  resumePendingAnswer() {
    if (!store.resumeAnswer()) return false;
    this.session = store.getSession(this.data.isPractice ? 'practice' : undefined);
    this.renderCurrent(store.getState());
    return true;
  },
  answerFailed(error, previous) {
    const pendingSession = this.session;
    this.session = previous;
    try {
      store.resumeAnswer();
      this.session = store.getSession(this.data.isPractice ? 'practice' : undefined) || previous;
      this.renderCurrent(store.getState());
    } catch (_) {
      if (error.answerPending) this.session = pendingSession;
    }
    wx.showToast({ title: require('../../utils/sync-storage').isFull(error)
      ? '本机存储写入失败，请保留记录并重新打开' : '本次保存未完成，请重试', icon: 'none' });
  },

  rate(event) {
    if (cloudSync.blocked()) { wx.showToast({ title: '请先在此接续学习', icon: 'none' }); return; }
    if (!this.data.revealed || this.data.completed || this.ratingBusy) return;
    const grade = event.currentTarget.dataset.grade;
    if (!['again', 'hard', 'good', 'easy'].includes(grade)) return;
    const timing = trace.begin('rate.' + grade);
    this.ratingBusy = true;
    const previousSession = JSON.parse(JSON.stringify(this.session));
    try {
    if (this.resumePendingAnswer()) return;
    this.onLearningTouch();
    if (this.rollToToday()) return;
    const state = store.getState();
    timing.mark('prepare');
    if (this.data.isPractice) {
      practice.recordAnswer(state, this.session, grade);
      this.captureElapsed(state);
      timing.mark('schedule');
      store.saveAnswer(state, this.session, this.data.word.id);
      timing.mark('save');
      this.renderCurrent(state, timing);
      return;
    }
    const item = this.currentItem();
    const word = getWord(item.wordId);
    const now = Date.now();
    const missed = grade === 'again' || grade === 'hard';
    const repeatMiss = item.phase === 'reinforcement' && missed && (state.recentReviews || []).some(answer =>
      answer.day === this.session.day && answer.wordId === word.id
      && ['new', 'review', 'reinforcement'].includes(answer.phase)
      && (answer.result === 'again' || answer.result === 'hard'));
    const previous = state.cards[word.id];
    state.cards[word.id] = scheduler.review(previous, grade, now);
    if (weakBook.shouldAutoMark(state.cards[word.id], grade)) weakBook.mark(state, word.id, 'formal', now);
    store.appendReview(state, {
      at: now,
      day: this.session.day,
      wordId: word.id,
      phase: item.phase,
      result: grade, scheduler: state.cards[word.id].fsrsVersion, modelRating: grade === 'easy' ? 4 : grade === 'good' ? 3 : 1,
      overdue: Boolean(item.overdue),
    });

    if (item.phase === 'review') {
      this.session.dueDone += 1;
      if (item.overdue) this.session.backlogDone = (this.session.backlogDone || 0) + 1;
    }
    if (item.phase === 'new') this.session.newDone += 1;
    if (item.phase === 'reinforcement') this.session.reinforcementDone += 1;
    this.session.ratings[grade] = (this.session.ratings[grade] || 0) + 1;

    if (item.phase === 'review' || item.phase === 'new') {
      studyPlan.queueContextCheck(this.session, word, grade, now);
    }

    if (missed) {
      const alreadyQueued = this.session.queue
        .slice(this.session.index + 1)
        .some((candidate) => candidate.wordId === word.id && candidate.phase === 'reinforcement');
      if (!alreadyQueued) {
        mastery.retry(this.session, item, now);
      }
      if (repeatMiss) studyPlan.queueContextCheck(this.session, word, grade, now, { repeatMiss: true });
    }

    this.captureElapsed(state);
    this.session.index += 1;
    studyOrder.reconcile(this.session, state);
    this.writeDailyProgress(state);
    timing.mark('schedule');
    store.saveAnswer(state, this.session, this.data.word.id);
    timing.mark('save');
    this.renderCurrent(state, timing);
    } catch (error) {
      this.answerFailed(error, previousSession);
    } finally {
      timing.finish();
      this.ratingBusy = false;
    }
  },

  toggleWeak() {
    if (!this.data.word) return;
    const state = store.getState();
    const marked = weakBook.toggle(state, this.data.word.id, Date.now());
    store.saveState(state, this.data.word.id);
    this.setData({ isWeakMarked: marked });
    wx.showToast({ title: marked ? '已加入易忘' : '已移出易忘', icon: 'none' });
  },

  toggleSentence() {
    const word = this.data.word;
    if (!word || this.sentenceSaveBusy) return;
    const question = this.data.isContext ? this.data.question : null;
    const entry = {
      sentence: question ? question.sentence : word.example,
      translation: question ? question.translation : word.translation,
      word: word.word, wordId: word.id,
    };
    if (!entry.sentence || !entry.translation) { wx.showToast({ title: '例句尚未准备好', icon: 'none' }); return; }
    this.sentenceSaveBusy = true;
    let before = this.data.isSentenceSaved;
    try {
      const state = store.getState();
      before = sentenceBook.has(state, entry.sentence);
      const saved = sentenceBook.toggle(state, entry);
      this.setData({ isSentenceSaved: saved });
      store.saveState(state, []);
      wx.showToast({ title: saved ? '已收藏例句' : '已取消收藏', icon: 'none', duration: 900 });
    } catch (error) {
      this.setData({ isSentenceSaved: before });
      wx.showToast({ title: '未能保存，请重试', icon: 'none' });
    } finally { this.sentenceSaveBusy = false; }
  },

  chooseContext(event) {
    if (cloudSync.blocked()) return;
    if (this.rollToToday()) return;
    if (this.data.contextAnswered) return;
    const previousSession = JSON.parse(JSON.stringify(this.session));
    try {
    if (this.resumePendingAnswer()) return;
    this.onLearningTouch();
    const index = Number(event.currentTarget.dataset.index);
    const question = this.data.question;
    const correct = index === question.answer;
    const now = Date.now();
    const item = this.currentItem();
    const state = store.getState();
    this.captureElapsed(state);
    const card = state.cards[item.wordId];
    if (!correct && card) {
      card.dueAt = Math.min(card.dueAt || now + DAY_MS, startOfDay(now) + DAY_MS);
      card.failedDay = dayKey(now);
      card.lastGrade = 'hard';
      card.interval = Math.min(card.interval || 1, 1);
      if (card.fsrs) card.fsrs = Object.assign({}, card.fsrs, { due: new Date(card.dueAt).toISOString(), scheduled_days: card.interval });
      if (item.phase === 'context') card.needsContext = item.questionId;
      else card.needsRecall = true;
      state.cards[item.wordId] = card;
      weakBook.mark(state, item.wordId, item.phase === 'context' ? 'context' : 'sentence', now);
    }
    if (correct && card && item.phase === 'context') card.needsContext = '';
    if (!correct) mastery.retry(this.session, item, now);
    store.appendReview(state, {
      at: now,
      day: this.session.day,
      wordId: item.wordId,
      phase: item.phase,
      result: correct ? 'correct' : 'wrong',
    });
    // Save the answered state before leaving the explanation screen.
    item.answered = true;
    item.correct = correct;
    item.selectedChoice = index;
    this.writeDailyProgress(state);
    store.saveAnswer(state, this.session, this.data.word.id);
    const task = metrics.summary(state, this.session, this.session.day);
    const active = metrics.section(task, studyOrder.kind(state, this.session, item));
    this.setData({
      taskLabel: active.label, taskVerb: active.verb, taskPending: active.pending, taskDone: active.done, taskTotal: active.total, progress: active.percent,
      contextAnswered: true,
      contextCorrect: correct,
      selectedChoice: index,
    });
    } catch (error) {
      this.answerFailed(error, previousSession);
    }
  },

  nextContext() {
    if (cloudSync.blocked()) return;
    if (this.rollToToday()) return;
    if (!this.data.contextAnswered) return;
    const previousSession = JSON.parse(JSON.stringify(this.session));
    try {
    if (this.resumePendingAnswer()) return;
    this.onLearningTouch();
    const item = this.currentItem();
    if (item.phase === 'sentence') {
      this.session.sentenceDone = (this.session.sentenceDone || 0) + 1;
      if (this.data.contextCorrect) this.session.sentenceCorrect = (this.session.sentenceCorrect || 0) + 1;
    } else {
      this.session.contextDone += 1;
      if (this.data.contextCorrect) this.session.contextCorrect += 1;
    }
    const state = store.getState();
    this.captureElapsed(state);
    this.session.index += 1;
    studyOrder.reconcile(this.session, state);
    this.writeDailyProgress(state);
    store.saveAnswer(state, this.session, this.data.word.id);
    this.renderCurrent(state);
    } catch (error) {
      this.answerFailed(error, previousSession);
    }
  },

  finishSession() {
    if (cloudSync.blocked()) return;
    clock.pause('study');
    const now = Date.now();
    const state = store.getState();
    this.captureElapsed(state);
    const time = timeLedger.summary(state.daily[timeLedger.dayKey(now)] || {}, timeLedger.dayKey(now));
    const minutes = Math.floor(time.seconds / 60);
    if (this.data.isPractice) {
      store.clearSession('practice');
      this.setData({ completed: true, sessionSummary: {
        minutes, usedTime: timeLedger.format(time.seconds), practiceDone: this.session.answers.length,
        remembered: this.session.ratings.good + this.session.ratings.easy,
      } });
      cloudSync.flush().catch(() => {});
      return;
    }
    const summary = this.writeDailyProgress(state, now);
    summary.minutes = minutes;
    summary.usedTime = timeLedger.format(time.seconds);
    summary.initialTime = summary.initialEstimate ? metrics.range(summary.initialEstimate.seconds) : '旧版未记录';
    store.saveState(state, []);
    store.clearSession();
    this.setData({ completed: true, sessionSummary: summary });
    cloudSync.flush().catch(() => {});
  },

  exitStudy() {
    if (this.returning) return;
    this.returning = true;
    try {
      clock.pause('study');
      if (this.session && !this.data.completed && !cloudSync.blocked()) {
        const state = store.getState();
        this.captureElapsed(state);
        this.writeDailyProgress(state);
        store.saveAnswer(state, this.session, []);
      }
      this.studyHidden = true;
      if (this.stopClock) this.stopClock();
      wx.switchTab({ url: '/pages/today/index',
        success: () => { setTimeout(() => cloudSync.flush().catch(() => {}), 500); },
        fail: () => { this.returning = false; this.studyHidden = false; wx.showToast({ title: '暂时无法返回，请重试', icon: 'none' }); },
      });
    } catch (error) {
      this.returning = false;
      wx.showToast({ title: '本机记录保存未完成，请保留缓存并重试', icon: 'none' });
    }
  },
});
