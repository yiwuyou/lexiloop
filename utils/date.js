const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(timestamp, days) {
  return timestamp + days * DAY_MS;
}

function formatMonthDay(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function daysUntil(dateString, now) {
  const target = startOfDay(`${dateString}T00:00:00`);
  return Math.max(0, Math.ceil((target - startOfDay(now || Date.now())) / DAY_MS));
}

function recentDayKeys(count, now) {
  const start = startOfDay(now || Date.now());
  const keys = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(dayKey(start - offset * DAY_MS));
  }
  return keys;
}

module.exports = {
  DAY_MS,
  addDays,
  dayKey,
  daysUntil,
  formatMonthDay,
  recentDayKeys,
  startOfDay,
};
