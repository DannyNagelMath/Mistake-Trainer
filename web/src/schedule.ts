// schedule.ts: Step 9. Which card to review next, from the deck and your review history.
// The rules follow Anki's:
//   1. cards that are due now, the most overdue first;
//   2. then new cards (never reviewed), up to NEW_CARDS_PER_DAY a day, in the deck's random order.
// A card is due once FSRS's due time for it has passed, to the millisecond. The scheduler below
// puts every review at least a day out, so a card never comes back within 24 hours.
// "A day" always means 24 hours counted from a review, never a calendar day:
//   - at most NEW_CARDS_PER_DAY new cards in any 24 hours;
//   - after you review a card, the other cards from its game wait until 24 hours after that
//     review, so you don't see two positions from one game on the same day. They only wait in
//     the queue: their FSRS schedules don't change.
// Mastered cards (see isMastered) leave the regular queue; "Practise mastered cards" deals them
// on request (pickMastered). Suspended cards never come up.
// This file also has the scheduler, and the grades for what you do on a card (gradeOf and
// winRatings). They're plain functions and values, so schedule.test.ts can check them without a page.

import { fsrs, Rating, State, type Grade } from 'ts-fsrs';

import type { Card } from './deck';
import type { CardResult } from './retroCtrl';
import type { ReviewEntry, ReviewHistory } from './reviews';

// export const NEW_CARDS_PER_DAY = 20; // Anki's default

// No limit for now, while testing: every new card can come up. A number brings a limit back.
export const NEW_CARDS_PER_DAY = Infinity;

// A card is mastered once FSRS's interval for it is at least this many days: after a right
// answer, FSRS expects you to remember it for a month or more.
export const MASTERED_DAYS = 30;

// The FSRS scheduler (ts-fsrs). With no learning or relearning steps, FSRS schedules every review
// at least a day out, Again included, and a card goes straight to the Review state. (ts-fsrs's
// defaults would bring a new or forgotten card back after 1 and 10 minutes.) Everything else is
// ts-fsrs's default: 90% desired retention, no fuzz, and FSRS-6's default weights.
export const scheduler = fsrs({ learning_steps: [], relearning_steps: [] });

// Only your first attempt counts. A wrong first move, "View the solution", or "Skip" is Again at
// once. After the right first move, you say how it went, with one of winRatings. If you move on
// without choosing, it counts as Good, which gradeOf gives for 'win'.
export const gradeOf = (result: CardResult): Grade => (result === 'win' ? Rating.Good : Rating.Again);

// The buttons after the right first move.
export const winRatings: { label: string; grade: Grade }[] = [
  { label: 'Worked it out', grade: Rating.Hard },
  { label: 'Found it quickly', grade: Rating.Good },
  { label: 'Obvious', grade: Rating.Easy },
];

const DAY = 24 * 60 * 60_000; // in milliseconds

const dueTime = (history: ReviewHistory, card: Card): number => new Date(history.cards[card.id].due).getTime();
const reviewTime = (entry: ReviewEntry): number => new Date(entry.log.review).getTime();

// Card ids are `${gameId}/${ply}` (deck.ts), and the log only has the id.
const gameOf = (cardId: string): string => cardId.slice(0, cardId.lastIndexOf('/'));

// The times you started new cards in the 24 hours up to `now`, oldest first.
const newCardStarts = (history: ReviewHistory, now: Date): number[] =>
  history.log
    .filter(e => e.log.state === State.New && reviewTime(e) > now.getTime() - DAY && reviewTime(e) <= now.getTime())
    .map(reviewTime)
    .sort((a, b) => a - b);

// How many new cards you've started in the 24 hours up to `now`.
export const newCardsInLastDay = (history: ReviewHistory, now: Date): number => newCardStarts(history, now).length;

// For each game you've reviewed, when its cards can come up again: 24 hours after its latest review.
function gameRestEnds(history: ReviewHistory): Map<string, number> {
  const ends = new Map<string, number>();
  for (const entry of history.log) {
    const game = gameOf(entry.cardId),
      end = reviewTime(entry) + DAY;
    if (end > (ends.get(game) ?? 0)) ends.set(game, end);
  }
  return ends;
}

// The cards you haven't suspended.
export const activeCards = (deck: Card[], history: ReviewHistory): Card[] =>
  history.suspended ? deck.filter(c => !history.suspended![c.id]) : deck;

// Mastered: the card's current FSRS interval is at least MASTERED_DAYS. Nothing extra is stored:
// a miss resets the interval to a day, which puts the card back in rotation.
export const isMastered = (history: ReviewHistory, card: Card): boolean =>
  !!history.cards[card.id] && Number(history.cards[card.id].scheduled_days) >= MASTERED_DAYS;

// The cards for each of the two rules, each in the order they'd be shown, leaving out suspended
// and mastered cards, and cards whose game is waiting. `newCardsPerDay` is there for the tests;
// the page uses NEW_CARDS_PER_DAY.
function queues(deck: Card[], history: ReviewHistory, now: Date, newCardsPerDay: number) {
  const restEnds = gameRestEnds(history);
  const gameWaiting = (c: Card) => (restEnds.get(c.gameId) ?? 0) > now.getTime();
  const active = activeCards(deck, history);
  const reviewed = active.filter(c => history.cards[c.id]).sort((a, b) => dueTime(history, a) - dueTime(history, b));
  return {
    due: reviewed.filter(c => dueTime(history, c) <= now.getTime() && !gameWaiting(c) && !isMastered(history, c)),
    fresh: active
      .filter(c => !history.cards[c.id] && !gameWaiting(c))
      .slice(0, Math.max(0, newCardsPerDay - newCardsInLastDay(history, now))),
  };
}

// The next card to show, or undefined when nothing is due. `avoid` is the card just shown: it's
// only picked again when there's no other choice.
export function pickNext(
  deck: Card[],
  history: ReviewHistory,
  now: Date,
  avoid?: string,
  newCardsPerDay = NEW_CARDS_PER_DAY,
): Card | undefined {
  const { due, fresh } = queues(deck, history, now, newCardsPerDay);
  const order = [...due, ...fresh];
  return order.find(c => c.id !== avoid) ?? order[0];
}

// For "Practise mastered cards": the mastered cards, the most overdue first and then the soonest
// due, leaving out suspended cards and cards whose game is waiting. Practising a card counts as a
// review, so its game waits too, and each comes up at most once in 24 hours.
function masteredQueue(deck: Card[], history: ReviewHistory, now: Date): Card[] {
  const restEnds = gameRestEnds(history);
  return activeCards(deck, history)
    .filter(c => isMastered(history, c) && (restEnds.get(c.gameId) ?? 0) <= now.getTime())
    .sort((a, b) => dueTime(history, a) - dueTime(history, b));
}

export function pickMastered(deck: Card[], history: ReviewHistory, now: Date, avoid?: string): Card | undefined {
  const order = masteredQueue(deck, history, now);
  return order.find(c => c.id !== avoid) ?? order[0];
}

// The counts in the progress box. Every card you haven't suspended is either not started, in
// rotation, or mastered.
export interface Progress {
  notStarted: number;
  inRotation: number;
  mastered: number;
  suspended: number;
  dueNow: number; // in rotation, due, and its game not waiting
  masteredNow: number; // mastered, and its game not waiting: what "Practise mastered cards" can deal
  reviewedLastDay: number;
}

export function progress(deck: Card[], history: ReviewHistory, now: Date): Progress {
  const active = activeCards(deck, history);
  const started = active.filter(c => history.cards[c.id]);
  const mastered = started.filter(c => isMastered(history, c)).length;
  return {
    notStarted: active.length - started.length,
    inRotation: started.length - mastered,
    mastered,
    suspended: deck.length - active.length,
    dueNow: queues(deck, history, now, NEW_CARDS_PER_DAY).due.length,
    masteredNow: masteredQueue(deck, history, now).length,
    reviewedLastDay: history.log.filter(e => reviewTime(e) > now.getTime() - DAY && reviewTime(e) <= now.getTime())
      .length,
  };
}

// How many more cards can come up now: the due ones, and the new ones the limit still allows.
export function cardsLeft(deck: Card[], history: ReviewHistory, now: Date, newCardsPerDay = NEW_CARDS_PER_DAY): number {
  const { due, fresh } = queues(deck, history, now, newCardsPerDay);
  return due.length + fresh.length;
}

// When the next card can come up in the regular queue, for the end of a session; undefined for
// an empty deck. Mastered cards don't count: they only come up when you practise them.
// A reviewed card comes up when it's due and its game has stopped waiting, whichever is later.
// A new card comes up when its game has stopped waiting and the new-card limit allows another:
// at the limit, that's when enough of the last 24 hours' new cards are 24 hours old.
export function nextAvailable(
  deck: Card[],
  history: ReviewHistory,
  now: Date,
  newCardsPerDay = NEW_CARDS_PER_DAY,
): Date | undefined {
  const restEnds = gameRestEnds(history);
  const starts = newCardStarts(history, now);
  const newCardAllowed =
    starts.length < newCardsPerDay ? now.getTime() : starts[starts.length - newCardsPerDay] + DAY;
  const times = activeCards(deck, history)
    .filter(c => !isMastered(history, c))
    .map(c =>
    Math.max(history.cards[c.id] ? dueTime(history, c) : newCardAllowed, restEnds.get(c.gameId) ?? 0),
  );
  return times.length ? new Date(Math.min(...times)) : undefined;
}
