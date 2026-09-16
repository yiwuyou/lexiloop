const questions = require('../data/context-questions');
const { getWord, getWords } = require('./words');

const byWord = {};
const byId = {};
questions.forEach((question) => {
  const key = question.word.toLowerCase();
  if (!byWord[key]) byWord[key] = [];
  byWord[key].push(question);
  byId[question.id] = question;
});

function wordOffset(word) {
  return String(word || '').split('').reduce((total, character) => total + character.charCodeAt(0), 0);
}

function getByWord(word, rotation) {
  const key = String(word || '').toLowerCase();
  const available = byWord[key] || [];
  if (!available.length) return null;
  if (rotation == null) return available[0];
  const index = (Math.abs(Number(rotation) || 0) + wordOffset(key)) % available.length;
  return available[index];
}

function fallbackQuestion(word) {
  if (!word || !word.example || !word.translation || !word.meaning) return null;
  const words = getWords();
  const choices = [word.meaning];
  const offsets = [137, 383, 761, 1091];
  offsets.forEach((offset) => {
    const candidate = words[(word.position + offset) % words.length];
    if (candidate && candidate.meaning && !choices.includes(candidate.meaning) && choices.length < 3) {
      choices.push(candidate.meaning);
    }
  });
  if (choices.length < 3) return null;
  const answer = wordOffset(word.id) % choices.length;
  const correct = choices.shift();
  choices.splice(answer, 0, correct);
  return {
    id: `auto-${word.id}`,
    word: word.word,
    sentence: word.example,
    translation: word.translation,
    choices,
    answer,
    explanation: `结合整句判断，${word.word} 在这里表示“${word.meaning}”。`,
  };
}

function getForWord(word, rotation) {
  return getByWord(word && word.word, rotation) || fallbackQuestion(word);
}

function getById(id) {
  if (byId[id]) return byId[id];
  if (String(id || '').startsWith('auto-')) return fallbackQuestion(getWord(String(id).slice(5)));
  return null;
}

module.exports = { getById, getByWord, getForWord };
