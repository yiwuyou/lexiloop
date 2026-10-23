// A scroll-view on iOS can swallow a button's native tap while stopping
// momentum. Accept a stationary short touch-end too, but never a drag/long
// press, and suppress the subsequent native tap from the same gesture.
function point(event) {
  const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
  if (!touch) return null;
  const p = { x: touch.pageX == null ? touch.clientX : touch.pageX, y: touch.pageY == null ? touch.clientY : touch.pageY };
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

function start(event) {
  const p = point(event);
  this.sentenceSuppressTapUntil = 0;
  this.sentenceLastTouchEnd = null;
  this.sentenceGesture = p ? { x: p.x, y: p.y, at: Date.now(), stamp: event.timeStamp, moved: false } : null;
}

function move(event) {
  const p = point(event);
  const gesture = this.sentenceGesture;
  if (gesture && p && (Math.abs(p.x - gesture.x) > 10 || Math.abs(p.y - gesture.y) > 10)) gesture.moved = true;
}

function end(event) {
  move.call(this, event);
  const gesture = this.sentenceGesture;
  this.sentenceGesture = null;
  if (!gesture) return;
  this.sentenceSuppressTapUntil = Date.now() + 450;
  this.sentenceLastTouchEnd = event.timeStamp;
  const duration = Number.isFinite(event.timeStamp) && Number.isFinite(gesture.stamp)
    ? event.timeStamp - gesture.stamp : Date.now() - gesture.at;
  if (!gesture.moved && duration >= 0 && duration <= 600) this.toggleSentence(event);
}

function cancel() {
  this.sentenceGesture = null;
  this.sentenceSuppressTapUntil = Date.now() + 450;
}

function tap(event) {
  const stamp = this.sentenceLastTouchEnd;
  if (Number.isFinite(stamp) && Number.isFinite(event.timeStamp) && event.timeStamp >= stamp && event.timeStamp - stamp < 250) return;
  if (Date.now() < (this.sentenceSuppressTapUntil || 0)) return;
  const gesture = this.sentenceGesture;
  this.sentenceGesture = null;
  if (gesture && gesture.moved) return;
  this.toggleSentence(event);
}

module.exports = { start, move, end, cancel, tap };
