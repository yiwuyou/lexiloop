const questions = require('../data/context-questions');

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

function getById(id) {
  return byId[id] || null;
}

module.exports = { getById, getByWord };
