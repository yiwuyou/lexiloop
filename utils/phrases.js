let data;
let pending;

function load() {
  if (data) return Promise.resolve(data);
  if (pending) return pending;
  pending = Promise.resolve()
    .then(() => require.async('../phrase-data/ready.js'))
    .then((module) => {
      data = module || {};
      pending = null;
      return data;
    }, (error) => {
      pending = null;
      throw error;
    });
  return pending;
}

async function phraseFor(word) {
  if (!word) return '';
  const phrases = await load();
  return phrases[word.id] || word.phrase || '';
}

module.exports = { load, phraseFor };
