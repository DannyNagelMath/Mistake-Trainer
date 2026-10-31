// reviews.test.ts: checks answerRates, how often you found the move, for Your stats.
import { expect, test } from 'vitest';

import type { CardResult } from './retroCtrl';
import { answerRates, type ReviewEntry } from './reviews';

const DAY = 24 * 60 * 60_000;
// A review of `cardId`, `daysAgo` days ago, with what you did first. Only what answerRates reads.
const review = (cardId: string, result: CardResult, daysAgo: number): ReviewEntry =>
  ({ cardId, result, log: { review: new Date(Date.now() - daysAgo * DAY).toISOString() } }) as unknown as ReviewEntry;

// Oldest first, as the log is. a: wrong, then right, then wrong; b: right twice; c: the solution
// viewed, then skipped.
const log = [
  review('a', 'fail', 50),
  review('b', 'win', 45),
  review('c', 'view', 40),
  review('a', 'win', 20),
  review('b', 'win', 10),
  review('c', 'skip', 5),
  review('a', 'fail', 2),
];

test('first time, came back, and came back after getting it wrong or right; only the right move counts as right', () => {
  expect(answerRates(log)).toEqual({
    firstTime: { right: 1, of: 3 }, // b
    cameBack: { right: 2, of: 4 }, // a's second, b's second
    afterWrong: { right: 1, of: 2 }, // a after wrong: right; c after the solution: skipped
    afterRight: { right: 1, of: 2 }, // b after right: right; a after right: wrong
  });
});

test('since a date: only the reviews from then on, each still split by the review before it', () => {
  expect(answerRates(log, new Date(Date.now() - 30 * DAY))).toEqual({
    firstTime: { right: 0, of: 0 },
    cameBack: { right: 2, of: 4 },
    afterWrong: { right: 1, of: 2 },
    afterRight: { right: 1, of: 2 },
  });
  expect(answerRates([])).toEqual(answerRates(log, new Date())); // nothing: all zeros
});
