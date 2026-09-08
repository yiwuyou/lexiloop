// Failed retrievals remain pending until a successful recall, including after restart.
function retry(session, item, now) {
  const tail = session.queue.slice(session.index + 1);
  const phase = item.phase === 'context' ? 'context' : 'reinforcement';
  if (tail.some(next => next.wordId === item.wordId && next.phase === phase)) return;
  session.queue.splice(Math.min(session.queue.length, session.index + 9), 0,
    Object.assign({}, item, { phase, reinforced: true, retry: (item.retry || 0) + 1,
      answered: false, correct: false, selectedChoice: -1,
      availableAt: now + 60000 }));
}

function remaining(session, cards) {
  const ids = [...new Set(session.queue.map(item => item.wordId))];
  return ids.filter(id => cards[id] && (cards[id].needsRecall || cards[id].needsContext));
}

function recover(session, cards) {
  if (session.index < session.queue.length) return;
  remaining(session, cards).forEach(id => {
    const card = cards[id];
    if (card.needsRecall) retry(session, { wordId: id, phase: 'reinforcement' }, 0);
    if (card.needsContext) retry(session, { wordId: id, phase: 'context', questionId: card.needsContext }, 0);
  });
}

function available(session, now) {
  const item = session.queue[session.index];
  if (!item || !item.availableAt || item.availableAt <= now) return true;
  const next = session.queue.findIndex((entry, index) => index > session.index && (!entry.availableAt || entry.availableAt <= now));
  if (next < 0) return false;
  session.queue.splice(session.index, 0, session.queue.splice(next, 1)[0]);
  return true;
}

module.exports = { retry, remaining, recover, available };
