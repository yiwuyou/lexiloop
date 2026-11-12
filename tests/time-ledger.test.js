const assert = require('assert/strict');
const ledger = require('../utils/time-ledger');
const day = '2026-11-12', [lo, hi] = ledger.bounds(day);
// Independent boundary oracle verifies the original overlap/phase semantics.
function oracle(daily) {
  const records = Object.values(daily.time.segments).filter(s => s && ledger.PHASES.includes(s.phase))
    .map(s => ({ start: Math.max(lo, s.start), end: Math.min(hi, s.end), phase: s.phase }))
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  const points = Array.from(new Set(records.flatMap(s => [s.start, s.end]))).sort((a,b) => a-b);
  const phases = Object.fromEntries(ledger.PHASES.map(p => [p, 0])); let ms = 0;
  for (let i=1;i<points.length;i++) {
    const active = records.filter(s => s.start <= points[i-1] && s.end >= points[i]).sort((a,b) => b.start-a.start || a.phase.localeCompare(b.phase));
    if (active.length) { ms += points[i]-points[i-1]; phases[active[0].phase] += (points[i]-points[i-1])/1000; }
  }
  return { seconds: Math.floor(ms/1000) + daily.time.legacySeconds, legacySeconds: daily.time.legacySeconds, phases };
}
let seed=19;
const random=() => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
for(let run=0;run<160;run++) {
  const daily={time:{legacySeconds:17,segments:{}}};
  for(let i=0;i<100;i++) {
    const start=lo-10000+Math.floor(random()*120)*1000;
    daily.time.segments['s'+i]={start,end:start+Math.floor(random()*25)*1000,phase:ledger.PHASES[i%ledger.PHASES.length]};
  }
  daily.time.segments.edge={start:hi-1000,end:hi+10000,phase:'detail'};
  daily.time.segments.bad={start:NaN,end:hi,phase:'new'};
  const expected=oracle(daily); assert.deepEqual(ledger.summary(daily,day),expected);
}
const large={time:{legacySeconds:0,segments:{}}};
for(let i=0;i<5000;i++) large.time.segments['s'+i]={start:lo+i*3000,end:lo+i*3000+2000,phase:'review'};
const filter=Array.prototype.filter; let examined=0;
Array.prototype.filter=function(callback,thisArg){examined+=this.length;return filter.call(this,callback,thisArg);};
let result;
try { result=ledger.summary(large,day); } finally { Array.prototype.filter=filter; }
assert.equal(result.seconds,10000); assert.equal(result.phases.review,10000);
assert.ok(examined<5000*20,'a long day must not rescan all segments at every boundary');
assert.equal(ledger.summary({minutes:3},day).seconds,180);
console.log('Time ledger: overlap ownership, equal-start phases, clipped/invalid intervals, legacy time and 5000-segment scan budget passed.');
