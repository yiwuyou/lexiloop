const questions = require('../data/context-questions');

const byWord = {};
const byId = {};
questions.forEach((question) => {
  byWord[question.word.toLowerCase()] = question;
  byId[question.id] = question;
});

function getByWord(word) {
  return byWord[String(word || '').toLowerCase()] || null;
}

function getById(id) {
  return byId[id] || null;
}

module.exports = { getById, getByWord };
