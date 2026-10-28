let engine;
let ready;
let pending;

function load() {
  if (ready) return Promise.resolve(ready);
  if (pending) return pending;
  pending = Promise.resolve().then(() => Promise.all([require.async('../relation-data/ready.js'), require.async('../relation-data/engine.js')]))
    .then(([data, loaded]) => { engine = loaded; ready = data; pending = null; return ready; }, (error) => { pending = null; throw error; });
  return pending;
}

async function forWord(wordId, state) { const data = await load(); return engine.build(wordId, data, state); }

module.exports = { load, forWord };
