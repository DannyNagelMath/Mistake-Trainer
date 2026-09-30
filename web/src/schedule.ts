// schedule.ts: Step 9. Which card to review next, from the deck and your review history.
// The rules follow Anki's:
//   1. cards that are due now, the most overdue first;
//   2. then new cards (never reviewed), up to NEW_CARDS_PER_DAY a day, in the deck's random order;
//   3. then, when nothing else is left, cards you're (re)learning that come back within the next
//      LEARN_AHEAD_MINUTES, so a session doesn't stop just to wait a few minutes for them.
// It also grades a card from what you did first (gradeOf). These are plain functions of their
// arguments, so schedule.test.ts can check them without a page.

import { Rating, State, type Grade } from 'ts-fsrs';

import type { Card } from './deck';
import type { CardResult } from './retroCtrl';
import type { ReviewHistory } from './reviews';

export const NEW_CARDS_PER_DAY = 20; // Anki's default
export const LEARN_AHEAD_MINUTES = 20; // Anki's default

// Like a Lichess puzzle, only your first attempt counts: the right move is Good, anything else Again.
export const gradeOf = (result: CardResult): Grade => (result === 'win' ? Rating.Good : Rating.Again);

const dueTime = (history: ReviewHistory, card: Card): number => new Date(history.cards[card.id].due).getTime();

// The file has the state as a number (State.Learning is 1), but ts-fsrs also accepts its name.
const stateOf = (history: ReviewHistory, card: Card): State => {
  const state = history.cards[card.id].state;
  return typeof state === 'string' ? State[state] : state;
};

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString(); // in local time

// How many new cards you've started today.
export const newCardsToday = (history: ReviewHistory, now: Date): number =>
  history.log.filter(e => e.log.state === State.New && sameDay(new Date(e.log.review), now)).length;

// The cards for each of the three rules, each in the order they'd be shown.
function queues(deck: Card[], history: ReviewHistory, now: Date) {
  const reviewed = deck.filter(c => history.cards[c.id]).sort((a, b) => dueTime(history, a) - dueTime(history, b));
  const aheadLimit = now.getTime() + LEARN_AHEAD_MINUTES * 60_000;
  const learning = (c: Card) => [State.Learning, State.Relearning].includes(stateOf(history, c));
  return {
    due: reviewed.filter(c => dueTime(history, c) <= now.getTime()),
    fresh: deck.filter(c => !history.cards[c.id]).slice(0, Math.max(0, NEW_CARDS_PER_DAY - newCardsToday(history, now))),
    ahead: reviewed.filter(c => dueTime(history, c) > now.getTime() && dueTime(history, c) <= aheadLimit && learning(c)),
  };
}

// The next card to show, or undefined when nothing is due. `avoid` is the card just shown: it's
// only picked again when there's no other choice.
export function pickNext(deck: Card[], history: ReviewHistory, now: Date, avoid?: string): Card | undefined {
  const { due, fresh, ahead } = queues(deck, history, now);
  const order = [...due, ...fresh, ...ahead];
  return order.find(c => c.id !== avoid) ?? order[0];
}

// How many more reviews are waiting, including ones coming back within the learn-ahead time.
export function cardsLeft(deck: Card[], history: ReviewHistory, now: Date): number {
  const { due, fresh, ahead } = queues(deck, history, now);
  return due.length + fresh.length + ahead.length;
}

// When the next card is due, or undefined if you've never reviewed one; new cards wait for tomorrow.
export function nextDue(deck: Card[], history: ReviewHistory): Date | undefined {
  const times = deck.filter(c => history.cards[c.id]).map(c => dueTime(history, c));
  return times.length ? new Date(Math.min(...times)) : undefined;
}
