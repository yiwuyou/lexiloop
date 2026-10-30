const ledger = require('./time-ledger');
const metrics = require('./learning-metrics');
function rows(state, count = 7, now = Date.now()) {
  return Object.keys(state.daily).sort().reverse().slice(0, count).map(day => {
    const daily = state.daily[day], time = ledger.summary(daily, day);
    const task = metrics.summary(state, null, day), p = time.phases;
    const hasStatus = Boolean(daily.taskStatus);
    return { day, used: ledger.format(time.seconds), initial: daily.initialEstimate ? metrics.range(daily.initialEstimate.seconds) : '旧版未记录',
      initialLabel: daily.initialEstimate && daily.initialEstimate.resumed ? '接续时预计' : '开始时预计',
      review: hasStatus ? task.reviewPassed : daily.dueDone || 0, new: hasStatus ? task.newPassed : daily.newDone || 0,
      wordLabel: hasStatus ? '过关' : '首答（旧版）',
      reviewTime: ledger.format(p.review), newTime: ledger.format(p.new), extraTime: ledger.format(p.reinforcement + p.sentence + p.context),
      practiceTime: ledger.format(p.practice), detailTime: ledger.format(p.detail),
      legacyTime: time.legacySeconds ? '含旧版约' + Math.round(time.legacySeconds / 60) + '分钟' : '',
      precise: Boolean(daily.time), today: day === ledger.dayKey(now) };
  });
}
module.exports = { rows };
