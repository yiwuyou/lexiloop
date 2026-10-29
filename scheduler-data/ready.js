// ts-fsrs 5.4.1 (FSRS-6), MIT. See LICENSE and THIRD_PARTY_NOTICES.md.
const { fsrs, createEmptyCard, Rating } = require('./vendor');
const engine = fsrs({ request_retention: 0.9, enable_fuzz: false, enable_short_term: true, learning_steps: [], relearning_steps: [] });
function review(previous, grade, now) {
  const card = previous ? Object.assign({}, previous, { due: new Date(previous.due), last_review: previous.last_review ? new Date(previous.last_review) : undefined }) : createEmptyCard(new Date(now));
  // Partial recall is not a successful retrieval of the institution's main sense.
  const rating = grade === 'easy' ? Rating.Easy : grade === 'good' ? Rating.Good : Rating.Again;
  return engine.next(card, new Date(now), rating).card;
}
module.exports = { review, version: 'FSRS-6/ts-fsrs-5.4.1', retention: 0.9 };
