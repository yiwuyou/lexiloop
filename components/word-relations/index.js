const relations = require('../../utils/relations');
const store = require('../../utils/store');
const copyWord = require('../../utils/copy-word');

Component({
  properties: { visible: Boolean, wordId: String },
  data: { closing: false, dragY: 0, dragging: false, loading: false, error: '', result: null, semantic: [], shapes: [], semanticLimit: 6, shapeLimit: 6, scrollTop: 0 },
  observers: {
    'visible, wordId': function (visible, wordId) {
      clearTimeout(this.closeTimer); this.closing = false; this.drag = this.mask = null;
      this.contentScrollTop = 0; this.suppressTapUntil = 0;
      this.setData({ closing: false, dragY: 0, dragging: false });
      if (!visible) { this.request = (this.request || 0) + 1; return; }
      if (!wordId) return;
      this.targetWordId = wordId;
      this.showWord(wordId);
    },
  },
  lifetimes: { detached() { clearTimeout(this.closeTimer); this.request = (this.request || 0) + 1; } },
  methods: {
    isTapBlocked() { return this.closing || this.data.dragging || Date.now() < (this.suppressTapUntil || 0); },
    copyWord(event) { if (!this.isTapBlocked()) copyWord.call(this, event); },
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
    contentScroll(event) {
      this.contentScrollTop = Math.max(0, Number(event.detail.scrollTop) || 0);
      if (this.contentScrollTop > 4 && this.dragSource === 'content' && this.drag) this.dragCancel();
    },
    contentStart(event) {
      this.dragSource = 'content';
      this.drag = event.touches.length === 1 && !this.closing && (this.contentScrollTop || 0) <= 4 ? event.touches[0] : null;
    },
    contentMove(event) { if (this.dragSource === 'content') this.dragMove(event); },
    contentEnd(event) { if (this.dragSource === 'content') this.dragEnd(event); },
    contentCancel() { if (this.dragSource === 'content') this.dragCancel(); },
    dragStart(event) { this.dragSource = 'header'; this.drag = event.touches.length === 1 && !this.closing ? event.touches[0] : null; },
    dragMove(event) {
      if (!this.drag) return;
      if (event.touches.length !== 1) { this.dragCancel(); return; }
      const point = event.touches[0], dy = point.clientY - this.drag.clientY;
      // Upward scrolling and horizontal movement never capture a close drag.
      if (!this.data.dragging && dy < -8) { this.dragCancel(); return; }
      if (!this.data.dragging && Math.abs(dy) < 10) return;
      if (Math.abs(point.clientX - this.drag.clientX) > Math.max(12, Math.abs(dy))) { this.dragCancel(); return; }
      this.setData({ dragging: true, dragY: Math.min(400, Math.max(0, dy)) });
    },
    dragEnd(event) {
      const start = this.drag, end = event.changedTouches[0]; this.drag = null;
      const dismiss = start && end && end.clientY - start.clientY >= 60 && end.clientY - start.clientY > 2 * Math.abs(end.clientX - start.clientX);
      if (this.data.dragging || dismiss) this.suppressTapUntil = Date.now() + 200;
      if (dismiss) this.close(); else this.dragCancel();
    },
    dragCancel() {
      if (this.data.dragging) this.suppressTapUntil = Date.now() + 200;
      this.drag = null;
      if (this.data.dragY || this.data.dragging) this.setData({ dragY: 0, dragging: false });
    },
    async showWord(wordId) {
      const request = this.request = (this.request || 0) + 1;
      this.setData({ loading: true, error: '', result: null, semantic: [], shapes: [], semanticLimit: 6, shapeLimit: 6, scrollTop: this.data.scrollTop ? 0 : 1 });
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
    retry() { if (!this.isTapBlocked()) this.showWord(this.targetWordId); },
    openDetail(event) {
      const wordId = event.currentTarget.dataset.id;
      if (wordId && !this.isTapBlocked()) this.triggerEvent('detail', { wordId });
    },
    moreSemantic() {
      if (this.isTapBlocked()) return;
      const limit = this.data.semanticLimit + 6;
      this.setData({ semanticLimit: limit, semantic: this.data.result.semantic.slice(0, limit) });
    },
    moreShapes() {
      if (this.isTapBlocked()) return;
      const limit = this.data.shapeLimit + 6;
      this.setData({ shapeLimit: limit, shapes: this.data.result.shapes.slice(0, limit) });
    },
  },
});
