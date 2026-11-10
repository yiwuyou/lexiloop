const assert=require('assert');
const {rolloverSession: rollover}=require('../utils/study-plan');
const {getWords}=require('../utils/words');
const metrics=require('../utils/learning-metrics');
const words=getWords(),day='2026-10-31',now=Date.parse(day+'T10:00:00+08:00');
const state={cards:{},daily:{'2026-10-30':{dueDone:100,newDone:50,minutes:40}},recentReviews:[]};
words.slice(0,200).forEach(w=>state.cards[w.id]={seen:true,reps:2,dueAt:now-10000,lastAt:now-86400000,passedDay:'2026-10-30'});
const id=words[0].id,old={day:'2026-10-30',index:1,queue:[{wordId:words[1].id,phase:'review'},{wordId:id,phase:'context',questionId:'existing-question'}],dueDone:100,newDone:50,dueGoal:100,newGoal:50};
const before=JSON.stringify(state.cards);
// A good recall yesterday may have a future FSRS due date, but its unfinished
// question must still carry over without changing that memory model.
state.cards[id].dueAt=now+4*86400000;
const actualBefore=JSON.stringify(state.cards);
assert.equal(rollover(old,state,{dailyNewCount:50,dailyReviewLimit:100,dailyBacklogLimit:30},now),true);
assert.equal(old.day,day);assert.equal(old.index,0);
assert.equal(old.queue[0].wordId,id);assert.equal(old.queue[0].phase,'review','today still needs actual independent recall');
assert.ok(old.queue.some(item=>item.questionId==='existing-question'),'preserve unfinished question while spacing it after independent recall');
assert.ok(old.queue.findIndex(item=>item.wordId===id&&item.phase==='review')<old.queue.findIndex(item=>item.questionId==='existing-question'));
assert.equal(old.dueDone,0);assert.equal(old.newDone,0);
assert.equal(metrics.summary(state,old,day).total,150);
assert.equal(JSON.stringify(state.cards),actualBefore,'rollover never fabricates a grade');
assert.equal(state.daily['2026-10-30'].minutes,40);
assert.equal(rollover(old,state,{},now),false);
const crowded={cards:{},daily:{},recentReviews:[]};
words.slice(0,150).forEach(w=>crowded.cards[w.id]={seen:true,reps:2,dueAt:now+86400000,lastAt:now-86400000});
const backlog={day:'2026-10-30',index:0,queue:words.slice(0,150).map(w=>({wordId:w.id,phase:'context',questionId:'saved-'+w.id})),dueGoal:100,newGoal:50};
rollover(backlog,crowded,{dailyNewCount:50,dailyReviewLimit:100,dailyBacklogLimit:30},now);
assert.equal(backlog.dueGoal,100);
assert.equal(Object.values(crowded.daily[day].carryTasks).filter(r=>r.item).length,150,'excess pending words stay durable for later days');
assert.equal(backlog.queue.filter(r=>r.phase==='context').length,100,'the daily cap is unchanged');
console.log('Midnight keeps questions/history, requires real recall and respects the unchanged daily limits.');


// Recreate the reported 106 + 100 split: only six current review IDs are new
// to the plan, while all 50 of today's new IDs differ from yesterday's.
const plan = require('../utils/study-plan');
const settings = { dailyNewCount: 50, dailyReviewLimit: 100, dailyBacklogLimit: 30 };
const yesterday = '2026-10-30';
const reviews = words.slice(0, 100);
const learnedYesterday = words.slice(100, 150);
const yesterdayPlan = Object.fromEntries(reviews.map(w => [w.id, 'review'])
  .concat(learnedYesterday.map(w => [w.id, 'new'])));
const startingState = { cards: {}, daily: { [yesterday]: {
  taskPlan: yesterdayPlan, firstAnswers: yesterdayPlan, dueDone: 100, newDone: 50,
} }, recentReviews: [] };
const selectedToday = new Set(reviews.slice(0, 94).concat(words.slice(150, 156)).map(w => w.id));
words.slice(0, 156).forEach(w => {
  startingState.cards[w.id] = { seen: true, lastAt: now - 86400000, dueAt: selectedToday.has(w.id) ? now - 1000 : now + 86400000 };
});
const clone = value => JSON.parse(JSON.stringify(value));
const closedYesterday = { day: yesterday, index: 0, queue: [], taskPlan: yesterdayPlan };
const stateFresh = clone(startingState), today = clone(closedYesterday);
assert.equal(rollover(today, stateFresh, settings, now), true);
assert.deepStrictEqual([metrics.summary(stateFresh, today, day).reviewGoal, metrics.summary(stateFresh, today, day).newGoal], [100, 50]);
assert.ok(today.queue.filter(item => item.phase === 'new').every(item => !stateFresh.cards[item.wordId]));
assert.equal(today.queue.length, 150);

const damaged = clone(startingState);
const stale = Object.assign(clone(closedYesterday), plan.buildSession(damaged, settings, now));
metrics.commit(damaged, stale, now);
plan.prepareSession(stale, damaged, settings, now);
assert.deepStrictEqual([metrics.summary(damaged, stale, day).reviewGoal, metrics.summary(damaged, stale, day).newGoal], [106, 100]);
assert.equal(stale.queue.length, 206);
const beforeRepair = JSON.stringify(damaged.cards);
assert.equal(plan.repairSessionPlan(stale, damaged, settings, now), true);
plan.prepareSession(stale, damaged, settings, now);
assert.deepStrictEqual([metrics.summary(damaged, stale, day).reviewGoal, metrics.summary(damaged, stale, day).newGoal], [100, 50]);
assert.equal(stale.queue.length, 150, 'remove only phantom work from the damaged queue');
assert.equal(JSON.stringify(damaged.cards), beforeRepair);
assert.equal(plan.repairSessionPlan(stale, damaged, settings, now), false);
assert.deepStrictEqual(damaged.daily[yesterday], startingState.daily[yesterday]);

const alreadyStudied = learnedYesterday[0].id;
const ungradedOld = learnedYesterday[1].id;
const trueNew = words[156].id;
const extra = clone(startingState);
extra.cards[alreadyStudied].lastAt = now - 2000;
extra.recentReviews.push({ wordId: alreadyStudied, phase: 'new', day, at: now - 2000, result: 'hard' });
const persisted = { day, index: 1, newGoal: 50, dueGoal: 0, queue: [
  { wordId: alreadyStudied, phase: 'new' }, { wordId: ungradedOld, phase: 'new' },
  { wordId: trueNew, phase: 'new' }, { wordId: alreadyStudied, phase: 'reinforcement' },
] };
metrics.commit(extra, persisted, now);
const bundleBefore = clone({ state: extra, settings, session: persisted });
assert.equal(plan.repairSessionPlan(persisted, extra, settings, now), true);
plan.prepareSession(persisted, extra, settings, now);
const counts = metrics.summary(extra, persisted, day);
assert.deepStrictEqual([counts.reviewSeen, counts.newSeen, counts.newGoal], [1, 0, 50]);
assert.equal(persisted.index, 1);
assert.deepStrictEqual(persisted.queue[0], { wordId: alreadyStudied, phase: 'new' }, 'keep the actual historical answer');
assert.ok(persisted.queue.slice(1).some(item => item.wordId === alreadyStudied && item.phase === 'reinforcement'));
assert.ok(!persisted.queue.slice(1).some(item => item.wordId === ungradedOld));
assert.ok(persisted.queue.filter(item => item.phase === 'new').slice(1).every(item => !extra.cards[item.wordId]));
const sync = require('../utils/sync-model');
const remote = clone(bundleBefore);
sync.apply(remote, { changes: sync.fineDiff(bundleBefore, { state: extra, settings, session: persisted }) });
const synced = metrics.summary(remote.state, remote.session, day);
assert.deepStrictEqual([synced.reviewSeen, synced.newSeen, synced.newGoal], [1, 0, 50], 'the deployed sync protocol preserves the repair');
assert.equal(remote.state.recentReviews[0].phase, 'new', 'correction never rewrites a submitted answer');
extra.daily[day].taskPlan[ungradedOld] = 'new'; // An older device can still hold the original day map.
extra.daily[day].taskPlan[alreadyStudied] = 'new';
extra.daily[day].firstAnswers[alreadyStudied] = 'new';
extra.daily[day].newDone = 1;
assert.deepStrictEqual([metrics.summary(extra, persisted, day).reviewSeen, metrics.summary(extra, persisted, day).newSeen], [1, 0]);

const carryState = clone(startingState);
const carrySession = { day: yesterday, index: 0, queue: [{ wordId: alreadyStudied, phase: 'new' }] };
rollover(carrySession, carryState, settings, now);
assert.ok(carrySession.queue.some(item => item.wordId === alreadyStudied && item.phase === 'review'));
assert.ok(!carrySession.queue.some(item => item.wordId === alreadyStudied && item.phase === 'new'));
console.log('Cross-day task lists stay at 100 + 50, repairs keep actual grades, and carried known words are reviews.');
