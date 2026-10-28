const relations = require('../../utils/relations');
const store = require('../../utils/store');

Component({
  properties: { visible: Boolean, wordId: String },
  data: { closing: false, dragY: 0, dragging: false, loading: false, error: '', result: null, semantic: [], shapes: [], semanticLimit: 6, shapeLimit: 6, canGoBack: false, scrollTop: 0 },
  observers: {
    'visible, wordId': function (visible, wordId) {
      clearTimeout(this.closeTimer); this.closing = false; this.drag = this.mask = null;
      this.setData({ closing: false, dragY: 0, dragging: false });
      if (!visible) { this.request = (this.request || 0) + 1; return; }
      if (!wordId) return;
      this.history = [wordId];
      this.showWord(wordId);
    },
  },
  lifetimes: { detached() { clearTimeout(this.closeTimer); this.request = (this.request || 0) + 1; } },
  methods: {
    copyWord: require('../../utils/copy-word'),
    noop() {},
    close() {
      if (this.closing) return;
      this.closing = true; this.request = (this.request || 0) + 1; this.drag = this.mask = null;
      this.setData({ closing: true, dragging: false });
      this.closeTimer = setTimeout(() => this.triggerEvent('close'), 180);
    },
    maskStart(event) { this.mask = event.touches.length === 1 ? event.touches[0] : null; },
    maskEnd(event) {
      const start = this.mask, end = event.changedTouches[0]; this.mask = null;
      if (start && end && Math.abs(end.clientX - start.clientX) < 12 && Math.abs(end.clientY - start.clientY) < 12) this.close();
    },
    maskCancel() { this.mask = null; },
    dragStart(event) { this.drag = event.touches.length === 1 && !this.closing ? event.touches[0] : null; },
    dragMove(event) {
      if (!this.drag) return;
      if (event.touches.length !== 1) { this.dragCancel(); return; }
      const point = event.touches[0], dy = point.clientY - this.drag.clientY;
      if (Math.abs(point.clientX - this.drag.clientX) > Math.max(12, Math.abs(dy))) { this.dragCancel(); return; }
      this.setData({ dragging: true, dragY: Math.min(400, Math.max(0, dy)) });
    },
    dragEnd(event) {
      const start = this.drag, end = event.changedTouches[0]; this.drag = null;
      if (start && end && end.clientY - start.clientY >= 60 && end.clientY - start.clientY > 2 * Math.abs(end.clientX - start.clientX)) this.close();
      else this.dragCancel();
    },
    dragCancel() { this.drag = null; this.setData({ dragY: 0, dragging: false }); },
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
