const assert = require('assert/strict');
const trace = require('../utils/interaction-trace');
let now=1000, page, callback, copied;
const realNow=Date.now; Date.now=()=>now;
global.wx={setClipboardData:value=>{copied=value.data;}};
global.Page=value=>{page=value;};
try {
  require('../pages/study/index');
  page.data=Object.assign({},page.data,{word:{id:'private-word-id',word:'PRIVATE_WORD'},isContext:false});
  page.setData=(patch,fn)=>{Object.assign(page.data,patch);callback=fn;};
  page.revealAnswer(); now+=1800; callback();
  let report=trace.report();
  assert.ok(report.includes('reveal')&&report.includes('viewCallback')&&report.includes('1800'));
  assert.ok(!report.includes('PRIVATE_WORD')&&!report.includes('private-word-id'));
  require('../pages/today/index'); page.copyPerformance();
  assert.equal(copied,report);
  for(let i=0;i<40;i++) trace.record('storage.answer',now,{chars:1024});
  report=trace.report();
  const samples=JSON.parse(report.slice(report.indexOf('\n')+1));
  assert.equal(samples.length,24,'timings remain a bounded in-memory ring');
  console.log('Interaction trace: actual delayed reveal callback, version copy, bounded samples and no word content passed.');
} finally {Date.now=realNow;}
