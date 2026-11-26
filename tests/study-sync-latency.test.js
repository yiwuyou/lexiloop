// Exercise the actual Continue handler with an isolated wx store and delayed cloud work.
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, "..");
const project = require('node:module').createRequire(path.join(root,'tests/answer-save.test.js'));
const mode = process.argv[2];
if (!mode) {
  for (const scenario of ['network', 'capture', 'pack', 'reply', 'local']) {
    const child = require('child_process').spawnSync(process.execPath, [__filename, scenario], {stdio:'inherit'});
    if (child.status !== 0) process.exit(1);
  }
  process.exit(0);
}
const clone = structuredClone;
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const block = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
let visible=false;
let page, armed=false, posted=false, injected=false, target,start,end,netStart,netEnd,cloudImage,clicked=false;
const values={};
global.Page = value => page=value;
global.wx={
  getStorageSync:key => values[key] ? clone(values[key]) : '',
  setStorageSync(key,value){if(armed && mode==='local' && clicked && key==='mem_vocab_answer_apply_v1' && !injected){injected=true;block(2000)}values[key]=clone(value)},
  removeStorageSync:key=>delete values[key],
  createInnerAudioContext:()=>({onPlay(){},onEnded(){},onStop(){},onError(){},stop(){},destroy(){}}),
  showToast(v){throw Error(v.title)},
  cloud:{init(){},async callFunction(){
    netStart=performance.now();

    await sleep(mode==='network'?2000:5);
    netEnd=performance.now();
    if(mode==='reply'){
      const bundle=clone(cloudImage);bundle.state.weakBook['remote-test']={addedAt:1};
      return {result:{ok:true,exists:true,bundle,rev:2,ack:1,owner:{device:'test-device',epoch:1}}}
    }
    return {result:{ok:true,exists:true,unchanged:true,rev:1,ack:1,owner:{device:'test-device',epoch:1}}}
  }}
};
const store=project('../utils/store'),plan=project('../utils/study-plan'),model=project('../utils/sync-model');
const storage=project('../utils/sync-storage'),cloud=project('../utils/cloud-sync'),clock=project('../utils/learning-clock');
const words=project('../utils/words').getWords(), scheduler=project('../utils/scheduler');
const stats={};
function hook(obj,key,label){
  const original=obj[key];
  obj[key]=function(...args){
    if(!armed || (label==='capture' && !new Error().stack.includes('at capture (')))return original.apply(this,args);
    const t=performance.now();
    if(!injected && mode===label){
      assert.ok(clicked, label+' ran before click'); assert.ok(!visible, label+' ran during learning'); injected=true;block(2000)
    }
    try{return original.apply(this,args)}finally{stats[label]=(stats[label]||0)+performance.now()-t}
  }
}
let resolveClick,rejectClick;
const done=new Promise((r,j)=>{resolveClick=r;rejectClick=j});
function post(){
  if(posted)return; posted=true;target=performance.now()+10;
  setTimeout(()=>{try{start=performance.now();clicked=true;const index=page.session.index;page.nextContext();assert.equal(page.session.index,index+1);assert.ok(end);resolveClick()}catch(e){rejectClick(e)}},10);
}
(async()=>{
  project('../pages/study/index');
  page.data=clone(page.data);page.setData=function(p,cb){Object.assign(this.data,p);if(cb)cb();if(clicked && p.word)end=performance.now()};
  const state=store.getState(),now=Date.now(),day=project('../utils/date').dayKey(now);
  for(const w of words.slice(0,1885))state.cards[w.id]={...scheduler.review(null,'good',now-86400000*7),dueAt:now-100};
  state.recentReviews=Array.from({length:3000},(_,i)=>({id:'r-'+i,at:now-(3001-i)*1000,day:'2026-11-20',phase:'review',result:'good',wordId:words[i%1885].id}));
  const session=plan.buildSession(state,store.getSettings(),now);
  const w=words.find(w=>w.id===session.queue[0].wordId);
  session.queue.unshift({wordId:w.id,phase:'sentence',questionId:'recall-'+w.id,reinforced:true});
  store.saveState(state);store.saveSession(session);page.onLoad({});
  cloudImage=store.bundle();
  storage.write('lexiloop_cloud_sync_v1',{device:'test-device',enabled:true,seq:0,rev:1,outbox:[],observed:cloudImage,fieldChangesVersion:1,owner:{device:'test-device',epoch:1},resourceRetryAt:now+3600000});
  cloud.start();page.chooseContext({currentTarget:{dataset:{index:page.data.question.answer}}});assert.ok(page.data.contextAnswered);
  cloudImage=store.bundle();
  hook(model,'fineDiff','capture');hook(project('../utils/sync-wire'),'batch','pack');hook(store,'replaceBundle','reply');
  let flight;
  if (mode==='network'||mode==='reply') flight=cloud.flush();
  page.onShow(); visible=true; armed=true;
  if (!flight && mode!=='local') flight=cloud.flush();
  // Let the 5 ms reply reach the app before tapping on the full-archive case.
  await sleep(35);
  post();
  await Promise.race([done,sleep(5000).then(()=>{throw Error('Continue did not advance')})]);
  if (mode!=='local') assert.ok(end-target<500, 'continue stalled');
  if (mode==='network') assert.ok(!netEnd, 'cloud already returned');
  if (mode==='reply') assert.ok(netEnd && !injected, 'archive applied during study');
  visible=false;page.onHide();
  await Promise.race([flight,sleep(8000).then(()=>{throw Error('Sync did not resume')})]);
  if (mode==='reply') assert.ok(store.bundle().state.weakBook['remote-test']);
  assert.ok(mode==='network'||injected);
  console.log(JSON.stringify({mode,queue:Math.round(start-target),handler:Math.round(end-start),total:Math.round(end-target),network:Math.round(netEnd-netStart)||0,stats}));
  cloud.dispose();clock.pause();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
