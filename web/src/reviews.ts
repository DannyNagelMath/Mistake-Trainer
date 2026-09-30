// reviews.ts: Step 9. Your review history: each reviewed card's spaced-repetition schedule, and
// a log of every review. It lives in data/reviews.json, which the dev server reads and writes
// for the page (see vite.config.ts), so it survives clearing the browser's data.
//
// The schedules come from FSRS (the ts-fsrs library), the algorithm Anki uses. FSRS works out
// when to show a card again from how you've done on it so far, aiming for a 90% chance that
// you'll still get it right by then.

import type { CardInput, ReviewLog } from 'ts-fsrs';

import type { CardResult } from './retroCtrl';

export interface ReviewEntry {
  cardId: string;
  result: CardResult; // what you did first: the right move, a wrong one, view the solution, or skip
  // ts-fsrs's record of the review; log.state is the card's state before it. Its dates are Dates
  // when just made, and strings once read back from the file, so read them with new Date(...).
  log: ReviewLog;
}

// In the file, dates are ISO strings; ts-fsrs accepts those (CardInput).
export interface ReviewHistory {
  cards: Record<string, CardInput>; // FSRS schedule by card id, for every card reviewed at least once
  log: ReviewEntry[]; // oldest first
}

export async function loadHistory(): Promise<ReviewHistory> {
  const response = await fetch('/api/reviews');
  if (!response.ok) throw new Error(`Couldn't load your review history: ${response.status} ${await response.text()}`);
  // A dev server started before vite.config.ts existed answers with the page itself (index.html).
  if (!response.headers.get('content-type')?.includes('json'))
    throw new Error("The dev server can't load your review history. Restart it (npm run dev) so it reads vite.config.ts.");
  return response.json();
}

// Saves one review: the card's new schedule, and the log entry.
export async function saveReview(card: CardInput, entry: ReviewEntry): Promise<void> {
  const response = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card, entry }),
  });
  if (!response.ok) throw new Error(`Couldn't save your review: ${response.status} ${await response.text()}`);
}
