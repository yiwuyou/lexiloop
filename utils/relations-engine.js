const { getWord, getWords } = require('./words');

let entries;
const shapeCache = {};
const AFFIXES = new Set(['tion', 'ation', 'ition', 'sion', 'ional', 'tional', 'ational', 'ication', 'ment', 'ness', 'able', 'ible', 'ally', 'ical', 'ously', 'ious', 'ous', 'ing', 'ated', 'ate', 'erate', 'ative', 'tive', 'ity', 'ive', 'ster', 'ance', 'ence', 'less', 'fully', 'inter', 'trans', 'anti', 'over', 'under']);

function headOf(word) { return (word.spokenWord || word.word).trim().toLowerCase(); }

function indexWords() {
  if (entries) return entries;
  entries = {};
  getWords().forEach((word) => {
    const head = headOf(word);
    if (!entries[head]) entries[head] = { head, id: word.id, word: word.word, sources: [], meanings: [], ids: [] };
    const entry = entries[head];
    entry.sources.push(word.sourceLabel);
    entry.ids.push(word.id);
    if (!entry.meanings.includes(word.meaning)) entry.meanings.push(word.meaning);
  });
  return entries;
}

function longestShared(left, right) {
  let best = { text: '', left: 0, right: 0 };
  let previous = Array(right.length + 1).fill(0);
  for (let i = 0; i < left.length; i += 1) {
    const current = Array(right.length + 1).fill(0);
    for (let j = 0; j < right.length; j += 1) {
      if (left[i] === right[j]) {
        current[j + 1] = previous[j] + 1;
        if (current[j + 1] > best.text.length) {
          best = { text: left.slice(i + 1 - current[j + 1], i + 1), left: i + 1 - current[j + 1], right: j + 1 - current[j + 1] };
        }
      }
    }
    previous = current;
  }
  return best;
}

function distance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[right.length];
}

function segments(text, offset, length) {
  if (!length) return [{ text, shared: false }];
  return [{ text: text.slice(0, offset), shared: false }, { text: text.slice(offset, offset + length), shared: true },
    { text: text.slice(offset + length), shared: false }].filter((part) => part.text);
}

function shapeLinks(head, data) {
  if (shapeCache[head]) return shapeCache[head];
  const map = indexWords();
  const explicit = {};
  (data.families || []).filter((group) => group.includes(head)).forEach((group) => {
    group.forEach((other) => { if (other !== head) explicit[other] = { score: 90, reason: '词族结构对照', note: '' }; });
  });
  (data.contrasts || []).forEach(([left, right, note]) => {
    const other = left === head ? right : right === head ? left : '';
    if (other) explicit[other] = { score: 110, reason: '易混词对照', note };
  });
  if (head === 'deliberate' || head === 'liberate') {
    explicit[head === 'deliberate' ? 'liberate' : 'deliberate'] = {
      score: 130, reason: '增减开头 de 的拼写对照',
      note: 'deliberate（深思熟虑；故意的）比 liberate（解放；释放）开头多 de。这里只对照字形，不把 de 当成构词解释，也不表示两词同源或同义。',
    };
  }
  const links = [];
  Object.keys(map).forEach((other) => {
    if (other === head) return;
    const fixed = explicit[other];
    const shared = longestShared(head, other);
    const maximum = Math.max(head.length, other.length);
    const minimum = Math.min(head.length, other.length);
    const edit = Math.abs(head.length - other.length) <= 2 ? distance(head, other) : 99;
    // Common endings alone are not a useful memory bridge, even when adding
    // two letters makes the edit-distance test look deceptively close.
    if (!fixed && AFFIXES.has(shared.text) && edit > 1) return;
    const closeSpelling = minimum >= 3 && (edit <= 1 || (minimum >= 6 && edit <= 2 && edit / maximum <= 0.28));
    const meaningfulBlock = shared.text.length >= 4 && shared.text.length / minimum >= 0.6
      && shared.text.length / maximum >= 0.45 && !AFFIXES.has(shared.text);
    if (!fixed && !closeSpelling && !meaningfulBlock) return;
    links.push(Object.assign({ head: other, shared }, fixed || {
      score: (closeSpelling ? 65 : 45) + 20 * shared.text.length / maximum - (edit === 99 ? 0 : edit),
      reason: closeSpelling ? '拼写相近' : '重复字母块', note: '',
    }));
  });
  shapeCache[head] = links;
  return links;
}

function decorate(entry, data, state) {
  return {
    id: entry.id, head: entry.head, word: entry.word,
    meaning: entry.meanings.join('；'),
    common: data.common[entry.head] || '暂无可靠的常用义，先记机构释义。',
    sourceLabel: entry.sources.join(' / '),
    learned: entry.ids.some((id) => Boolean(state && state.cards && state.cards[id] && state.cards[id].seen)),
  };
}

function build(wordId, data, state) {
  const word = getWord(wordId);
  if (!word) return null;
  const head = headOf(word);
  const map = indexWords();
  const target = decorate(map[head], data, state);
  // Preserve the exact institution sense on the currently displayed source card.
  target.meaning = word.meaning;
  const semantic = (data.synonyms[head] || []).filter((link) => map[link.word] && link.word !== head)
    .map((link) => Object.assign(decorate(map[link.word], data, state), { sense: link.sense || '部分义项接近，请对照两种释义', parts: [{ text: link.word, shared: false }] }))
    .sort((left, right) => Number(right.learned) - Number(left.learned) || left.head.localeCompare(right.head));
  const shapes = shapeLinks(head, data).map((link) => {
    const entry = decorate(map[link.head], data, state);
    return Object.assign(entry, {
      score: link.score + (entry.learned ? 8 : 0), note: link.note,
      reason: link.reason,
      shared: link.shared.text,
      parts: segments(entry.head, link.shared.right, link.shared.text.length),
      targetParts: segments(head, link.shared.left, link.shared.text.length),
    });
  }).sort((left, right) => right.score - left.score || left.head.localeCompare(right.head));
  return { target, semantic, shapes };
}

module.exports = { build, headOf, longestShared, segments };
