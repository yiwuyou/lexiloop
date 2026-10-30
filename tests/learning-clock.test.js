const assert=require('assert');
const values={},clone=x=>JSON.parse(JSON.stringify(x));
global.wx={getStorageSync:k=>values[k]?clone(values[k]):'',setStorageSync:(k,v)=>{values[k]=clone(v);},removeStorageSync:k=>{delete values[k];}};
const store=require('../utils/store'), clock=require('../utils/learning-clock'), ledger=require('../utils/time-ledger');
const realNow=Date.now;let now=Date.parse('2026-10-30T10:00:00+08:00');Date.now=()=>now;
function reset(at){clock.pause();Object.keys(values).forEach(k=>delete values[k]);now=at;store.saveState({schemaVersion:3,cards:{},daily:{},weakBook:{},recentReviews:[]});store.getSettings();}
try{
 reset(now);const day=ledger.dayKey(now);
 clock.enter('review');now+=30000;clock.capture();
 assert.equal(ledger.summary(store.getState().daily[day],day).seconds,30);
 clock.pause('study');now+=600000;clock.capture();
 assert.equal(ledger.summary(store.getState().daily[day],day).seconds,30,'background is paused');
 clock.enter('new');now+=240000;clock.capture();
 assert.equal(ledger.summary(store.getState().daily[day],day).seconds,210,'idle is capped at three minutes');
 assert.equal(clock.status().active,false);
 clock.enter('detail',now,'detail');now+=10000;clock.pause('study');
 assert.equal(clock.status().active,true,'a hidden parent must not stop the visible detail clock');
 clock.pause('detail');assert.equal(ledger.summary(store.getState().daily[day],day).seconds,220);
 reset(Date.parse('2026-10-30T23:59:50+08:00'));
 clock.enter('review');now+=20000;clock.capture();clock.pause();
 assert.equal(ledger.summary(store.getState().daily['2026-10-30'],'2026-10-30').seconds,10);
 assert.equal(ledger.summary(store.getState().daily['2026-10-31'],'2026-10-31').seconds,10);
 reset(Date.parse('2026-10-30T12:00:00+08:00'));
 const state=store.getState();state.daily[day]={minutes:2};store.saveState(state);
 clock.enter('new');now+=15000;clock.capture();clock.pause();
 assert.equal(ledger.summary(store.getState().daily[day],day).seconds,135,'preserve older minutes exactly once');
 console.log('Foreground, idle pause, detail ownership, midnight split and legacy time migration passed.');
}finally{clock.pause();Date.now=realNow;}
