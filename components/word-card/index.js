const tap = require('../../utils/sentence-tap');
Component({ options: { styleIsolation: 'apply-shared' }, properties: {
  word: Object, revealed: Boolean, phaseLabel: String, isWeakMarked: Boolean,
  isSentenceSaved: Boolean, audioLoading: Boolean, showRelations: { type: Boolean, value: true }
}, methods: {
  copyWord: require('../../utils/copy-word'),
  sentenceTouchStart: tap.start, sentenceTouchMove: tap.move, sentenceTouchEnd: tap.end, sentenceTouchCancel: tap.cancel, tapSentence: tap.tap,
  playPronunciation() { this.triggerEvent('audio'); }, toggleWeak() { this.triggerEvent('weak'); },
  toggleSentence() { this.triggerEvent('sentence'); }, revealAnswer() { this.triggerEvent('reveal'); }, openRelations() { this.triggerEvent('relations'); }
} });
