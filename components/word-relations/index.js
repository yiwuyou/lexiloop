const relations = require('../../utils/relations');
const store = require('../../utils/store');

Component({
  properties: { visible: Boolean, wordId: String },
  data: { loading: false, error: '', result: null, semantic: [], shapes: [], semanticLimit: 6, shapeLimit: 6, canGoBack: false, scrollTop: 0 },
  observers: {
    'visible, wordId': function (visible, wordId) {
      if (!visible) { this.request = (this.request || 0) + 1; return; }
      if (!wordId) return;
      this.history = [wordId];
      this.showWord(wordId);
    },
  },
  lifetimes: { detached() { this.request = (this.request || 0) + 1; } },
  methods: {
    copyWord: require('../../utils/copy-word'),
    noop() {},
    close() { this.request = (this.request || 0) + 1; this.triggerEvent('close'); },
    async showWord(wordId) {
      const request = this.request = (this.request || 0) + 1;
      this.setData({ loading: true, error: '', result: null, semantic: [], shapes: [], semanticLimit: 6, shapeLimit: 6, canGoBack: this.history.length > 1, scrollTop: this.data.scrollTop ? 0 : 1 });
      try {
        const result = await relations.forWord(wordId, store.getState());
        if (request !== this.request) return;
        if (!result) throw new Error('missing-word');
        this.setData({ result, semantic: result.semantic.slice(0, 6), shapes: result.shapes.slice(0, 6) });
      } catch (error) {
        if (request === this.request) this.setData({ error: '关联资料暂未加载，点击重试' });
      } finally {
        if (request === this.request) this.setData({ loading: false });
      }
    },
    retry() { this.showWord(this.history[this.history.length - 1]); },
    explore(event) {
      const wordId = event.currentTarget.dataset.id;
      if (!wordId || this.history[this.history.length - 1] === wordId) return;
      this.history.push(wordId);
      this.showWord(wordId);
    },
    goBack() {
      if (this.history.length < 2) return;
      this.history.pop();
      this.showWord(this.history[this.history.length - 1]);
    },
    moreSemantic() {
      const limit = this.data.semanticLimit + 6;
      this.setData({ semanticLimit: limit, semantic: this.data.result.semantic.slice(0, limit) });
    },
    moreShapes() {
      const limit = this.data.shapeLimit + 6;
      this.setData({ shapeLimit: limit, shapes: this.data.result.shapes.slice(0, limit) });
    },
  },
});
