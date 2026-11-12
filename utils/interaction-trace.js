// In-memory timings only: no words, record contents, identities or cloud calls.
const samples = [], LIMIT = 24;
function add(sample) { samples.push(sample); if (samples.length > LIMIT) samples.shift(); }
function begin(action) {
  const started = Date.now(); let last = started, added = false;
  const sample = { action, ms: 0, stages: {} };
  return {
    mark(stage) { const now = Date.now(); sample.stages[stage] = now-last; last = now; },
    finish() { sample.ms = Date.now()-started; if (!added) { add(sample); added = true; } },
  };
}
function record(action, started, details) { add(Object.assign({ action, ms: Date.now()-started }, details || {})); }
function report() { return '词序 ' + require('./version') + ' 性能诊断\n' + JSON.stringify(samples); }
module.exports = { begin, record, report };
