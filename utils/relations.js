const engine = require('./relations-engine');
let ready;
let pending;

function load() {
  if (ready) return Promise.resolve(ready);
  if (pending) return pending;
  pending = Promise.resolve().then(() => require.async('../relation-data/ready.js'))
    .then((data) => { ready = data; pending = null; return ready; }, (error) => { pending = null; throw error; });
  return pending;
}

async function forWord(wordId, state) { return engine.build(wordId, await load(), state); }

module.exports = { load, forWord };
