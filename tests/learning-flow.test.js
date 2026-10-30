const assert=require('assert');
const values={},clone=x=>JSON.parse(JSON.stringify(x));
let page,now=Date.parse('2026-10-30T10:00:00+08:00');
const originalNow=Date.now;Date.now=()=>now;
global.wx={getStorageSync:k=>values[k]?clone(values[k]):'',setStorageSync:(k,v)=>{values[k]=clone(v);},removeStorageSync:k=>delete values[k],showToast(){},
 createInnerAudioContext:()=>({onPlay(){},onEnded(){},onStop(){},onError(){},stop(){},destroy(){}})};
global.Page=definition=>{page=definition;};
const store=require('../utils/store'),words=require('../utils/words').getWords(),scheduler=require('../utils/scheduler');
const plan=require('../utils/study-plan'),metrics=require('../utils/learning-metrics'),clock=require('../utils/learning-clock');
try{
 const state=store.getState(),settings=store.getSettings();
 words.slice(0,100).forEach(w=>{state.cards[w.id]=Object.assign(scheduler.review(null,'good',now-7*86400000),{dueAt:now-10000});});
 const session=plan.buildSession(state,settings,now);metrics.commit(state,session,now);
 state.daily[session.day].dueGoal=session.dueGoal;state.daily[session.day].newGoal=session.newGoal;
 store.saveState(state);store.saveSession(session);
 require('../pages/study/index');
 page.data=clone(page.data);page.setData=function(patch,callback){Object.entries(patch).forEach(([key,value])=>{const parts=key.split('.');let target=this.data;for(const p of parts.slice(0,-1))target=target[p];target[parts.at(-1)]=value;});if(callback)callback();};
 page.onLoad({});page.onShow();
 assert.equal(page.data.taskDone,0);assert.equal(page.data.taskTotal,150);
 page.revealAnswer();now+=5000;page.rate({currentTarget:{dataset:{grade:'hard'}}});
 assert.equal(page.data.taskDone,0);assert.equal(page.data.taskTotal,150);
 let steps=0;
 while(!page.data.completed&&steps++<400){
  now+=3000;
  if(page.data.isContext){page.chooseContext({currentTarget:{dataset:{index:page.data.question.answer}}});page.nextContext();}
  else{page.revealAnswer();page.rate({currentTarget:{dataset:{grade:'easy'}}});}
  assert.equal(page.data.taskTotal,150,'repeated questions never change the word goal');
 }
 assert.ok(page.data.completed,'all required tasks eventually finish');
 const daily=store.getState().daily['2026-10-30'];
 assert.equal(daily.dueDone,100);assert.equal(daily.newDone,50);
 const final=metrics.summary(store.getState(),null,'2026-10-30');
 assert.equal(final.done,150);assert.equal(final.percent,100);
 assert.ok(daily.time&&daily.initialEstimate&&daily.minutes>0);
 assert.ok(daily.reinforcementDone>0&&daily.sentenceDone>0);
 page.onUnload();
 console.log('Real page flow: 100 old + 50 new, failed recall/retry/sentence, accurate completion and saved timing passed.');
}finally{clock.pause();Date.now=originalNow;}
