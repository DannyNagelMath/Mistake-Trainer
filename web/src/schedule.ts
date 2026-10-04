// schedule.ts: Step 9. Which card to review next, from the deck and your review history.
// The rules follow Anki's:
//   1. cards that are due now, the most overdue first;
//   2. then new cards (never reviewed), up to NEW_CARDS_PER_DAY a day, in the deck's random order.
// A card is due once FSRS's due time for it has passed, to the millisecond. The scheduler below
// puts every review at least a day out, so a card never comes back within 24 hours.
// This file also has the scheduler and grades a card from what you did first (gradeOf). They're
// plain functions and values, so schedule.test.ts can check them without a page.

import { fsrs, Rating, State, type Grade } from 'ts-fsrs';

import type { Card } from './deck';
import type { CardResult } from './retroCtrl';
import type { ReviewHistory } from './reviews';

// export const NEW_CARDS_PER_DAY = 20; // Anki's default

export const NEW_CARDS_PER_DAY = 5; 

// The FSRS scheduler (ts-fsrs). With no learning or relearning steps, FSRS schedules every review
// at least a day out, Again included, and a card goes straight to the Review state. (ts-fsrs's
// defaults would bring a new or forgotten card back after 1 and 10 minutes.) Everything else is
// ts-fsrs's default: 90% desired retention, no fuzz, and FSRS-6's default weights.
export const scheduler = fsrs({ learning_steps: [], relearning_steps: [] });

// Like a Lichess puzzle, only your first attempt counts: the right move is Good, anything else Again.
export const gradeOf = (result: CardResult): Grade => (result === 'win' ? Rating.Good : Rating.Again);

const dueTime = (history: ReviewHistory, card: Card): number => new Date(history.cards[card.id].due).getTime();

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString(); // in local time

// How many new cards you've started today.
export const newCardsToday = (history: ReviewHistory, now: Date): number =>
  history.log.filter(e => e.log.state === State.New && sameDay(new Date(e.log.review), now)).length;

// The cards for each of the two rules, each in the order they'd be shown.
function queues(deck: Card[], history: ReviewHistory, now: Date) {
  const reviewed = deck.filter(c => history.cards[c.id]).sort((a, b) => dueTime(history, a) - dueTime(history, b));
  return {
    due: reviewed.filter(c => dueTime(history, c) <= now.getTime()),
    fresh: deck.filter(c => !history.cards[c.id]).slice(0, Math.max(0, NEW_CARDS_PER_DAY - newCardsToday(history, now))),
  };
}

// The next card to show, or undefined when nothing is due. `avoid` is the card just shown: it's
// only picked again when there's no other choice.
export function pickNext(deck: Card[], history: ReviewHistory, now: Date, avoid?: string): Card | undefined {
  const { due, fresh } = queues(deck, history, now);
  const order = [...due, ...fresh];
  return order.find(c => c.id !== avoid) ?? order[0];
}

// How many more cards are waiting now: the due ones, and today's remaining new ones.
export function cardsLeft(deck: Card[], history: ReviewHistory, now: Date): number {
  const { due, fresh } = queues(deck, history, now);
  return due.length + fresh.length;
}

// When the next card is due, or undefined if you've never reviewed one; new cards wait for tomorrow.
export function nextDue(deck: Card[], history: ReviewHistory): Date | undefined {
  const times = deck.filter(c => history.cards[c.id]).map(c => dueTime(history, c));
  return times.length ? new Date(Math.min(...times)) : undefined;
}
