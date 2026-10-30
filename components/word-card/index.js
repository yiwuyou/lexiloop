const tap = require('../../utils/sentence-tap');
Component({ options: { styleIsolation: 'apply-shared' }, properties: {
  word: Object, revealed: Boolean, phaseLabel: String, isWeakMarked: Boolean,
  isSentenceSaved: Boolean, audioLoading: Boolean
}, methods: {
  copyWord: require('../../utils/copy-word'),
  showPartOfSpeech() { wx.showModal({ title: '词性说明', content: this.data.word.partOfSpeech, showCancel: false }); },
  sentenceTouchStart: tap.start, sentenceTouchMove: tap.move, sentenceTouchEnd: tap.end, sentenceTouchCancel: tap.cancel, tapSentence: tap.tap,
  playPronunciation() { this.triggerEvent('audio'); }, toggleWeak() { this.triggerEvent('weak'); },
  toggleSentence() { this.triggerEvent('sentence'); }, revealAnswer() { this.triggerEvent('reveal'); }
} });
