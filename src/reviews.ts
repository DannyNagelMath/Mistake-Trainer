// reviews.ts: Not in lila. Your review history: each reviewed card's spaced-repetition schedule, and
// a log of every review. The schedules come from FSRS (the ts-fsrs library), the algorithm Anki
// uses: it works out when to show a card again from how you've done on it so far, aiming for a 90%
// chance that you'll still get it right by then.

import type { CardInput, ReviewLog } from 'ts-fsrs';

import type { CardResult } from './retroCtrl';

export interface ReviewEntry {
  cardId: string;
  result: CardResult; // what you did first: the right move, a wrong one, view the solution, or skip
  // The move you played first, if you did ('win' or 'fail'), as the move list writes it (san) and
  // in UCI. Reviews from before October 29, 2026 don't have it.
  move?: { san: string; uci: string };
  // ts-fsrs's record of the review; log.state is the card's state before it. Its dates are Dates
  // when just made, and strings once read back from the file, so read them with new Date(...).
  log: ReviewLog;
}

// In the file, dates are ISO strings; ts-fsrs accepts those (CardInput).
export interface ReviewHistory {
  cards: Record<string, CardInput>; // FSRS schedule by card id, for every card reviewed at least once
  log: ReviewEntry[]; // oldest first
  // Cards you've suspended ("Suspend card"): when, by card id. They never come up again, unless
  // you unsuspend them in Training settings.
  suspended?: Record<string, string>;
}

// How often you found the move, for Your stats (statsView.ts): on each card's first review, and when cards
// came back, split by how the card went the time before. Only the right first move counts as right;
// a wrong one, "View the solution", and "Skip" don't. With `since`, only the reviews from then on,
// each still split by the review before it, whenever that was.
export interface Rate {
  right: number;
  of: number;
}
export interface AnswerRates {
  firstTime: Rate;
  cameBack: Rate;
  afterWrong: Rate; // came back, after anything but the right move the time before
  afterRight: Rate;
}
export function answerRates(log: ReviewEntry[], since?: Date): AnswerRates {
  const rates: AnswerRates = {
    firstTime: { right: 0, of: 0 },
    cameBack: { right: 0, of: 0 },
    afterWrong: { right: 0, of: 0 },
    afterRight: { right: 0, of: 0 },
  };
  const latest = new Map<string, ReviewEntry>(); // each card's review before this one, by card id
  for (const entry of log) {
    const before = latest.get(entry.cardId);
    latest.set(entry.cardId, entry);
    if (since && new Date(entry.log.review) < since) continue;
    const add = (rate: Rate) => {
      rate.of++;
      if (entry.result === 'win') rate.right++;
    };
    if (!before) add(rates.firstTime);
    else {
      add(rates.cameBack);
      add(before.result === 'win' ? rates.afterRight : rates.afterWrong);
    }
  }
  return rates;
}
