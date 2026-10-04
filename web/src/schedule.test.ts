// schedule.test.ts: Step 9. Checks which card schedule.ts picks next.
import { createEmptyCard, Rating, State, type CardInput } from 'ts-fsrs';
import { expect, test } from 'vitest';

import type { Card } from './deck';
import type { ReviewHistory } from './reviews';
import { cardsLeft, gradeOf, NEW_CARDS_PER_DAY, newCardsToday, nextDue, pickNext, scheduler } from './schedule';

const now = new Date('2026-09-30T12:00:00');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const card = (id: string): Card => ({ id, gameId: id.split('/')[0], ply: Number(id.split('/')[1]), color: 'white' });
const deck = ['a/1', 'b/3', 'c/5', 'd/7'].map(card);

// A schedule in the given state, due at the given time.
const scheduled = (state: State, due: Date): CardInput => ({ ...createEmptyCard(now), state, due });

const history = (cards: Record<string, CardInput> = {}): ReviewHistory => ({ cards, log: [] });

test('with no history, new cards come in deck order', () => {
  expect(pickNext(deck, history(), now)?.id).toBe('a/1');
  expect(cardsLeft(deck, history(), now)).toBe(4);
});

test('cards that are due come before new ones, the most overdue first', () => {
  const h = history({
    'c/5': scheduled(State.Review, minutes(-60)),
    'b/3': scheduled(State.Review, minutes(-600)),
  });
  expect(pickNext(deck, h, now)?.id).toBe('b/3');
  expect(cardsLeft(deck, h, now)).toBe(4); // 2 due + 2 new
});

test("cards that aren't due yet wait", () => {
  const h = history({ 'a/1': scheduled(State.Review, minutes(60 * 24)) });
  expect(pickNext(deck, h, now)?.id).toBe('b/3');
  expect(cardsLeft(deck, h, now)).toBe(3);
});

test('cards left in Learning or Relearning by the old steps wait until they are due, like any other', () => {
  const soon = history({
    'a/1': scheduled(State.Learning, minutes(5)),
    'b/3': scheduled(State.Relearning, minutes(15)),
    'c/5': scheduled(State.Review, minutes(10)),
  });
  expect(pickNext(deck, soon, now)?.id).toBe('d/7'); // the only new card; nothing comes early
  expect(cardsLeft(deck, soon, now)).toBe(1);
  expect(pickNext(deck, soon, minutes(6))?.id).toBe('a/1'); // once it's due
});

// The scheduler: every answer puts the card at least a day out, in the Review state.
const atLeastADay = (due: Date, from: Date) => due.getTime() - from.getTime() >= 24 * 60 * 60_000;
const grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

test('a new card comes back at least a day later, whatever the answer', () => {
  for (const grade of grades) {
    const { card } = scheduler.next(createEmptyCard(now), now, grade);
    expect(card.state).toBe(State.Review);
    expect(atLeastADay(card.due, now)).toBe(true);
  }
});

test('a forgotten card comes back a day later, not in minutes', () => {
  const learnt = scheduler.next(scheduler.next(createEmptyCard(now), now, Rating.Good).card, minutes(60 * 48), Rating.Good).card;
  const reviewedAt = new Date(learnt.due);
  const { card } = scheduler.next(learnt, reviewedAt, Rating.Again);
  expect(card.state).toBe(State.Review);
  expect(atLeastADay(card.due, reviewedAt)).toBe(true);
});

test('a card left in Learning or Relearning by the old steps moves to Review, at least a day out', () => {
  for (const state of [State.Learning, State.Relearning])
    for (const grade of grades) {
      const { card } = scheduler.next({ ...scheduled(state, minutes(-1)), stability: 0.5, difficulty: 5, reps: 1 }, now, grade);
      expect(card.state).toBe(State.Review);
      expect(atLeastADay(card.due, now)).toBe(true);
    }
});

test('the card just shown only comes again when there is no other', () => {
  expect(pickNext(deck, history(), now, 'a/1')?.id).toBe('b/3');
  const tomorrow = scheduled(State.Review, minutes(60 * 24));
  const onlyA = history({ 'b/3': tomorrow, 'c/5': tomorrow, 'd/7': tomorrow }); // a/1 is the only new card
  expect(pickNext(deck, onlyA, now, 'a/1')?.id).toBe('a/1');
});

test('at most NEW_CARDS_PER_DAY new cards a day', () => {
  const h = history();
  const review = { state: State.New, review: now } as never;
  h.log = Array.from({ length: NEW_CARDS_PER_DAY }, (_, i) => ({ cardId: `x/${i}`, result: 'win', log: review }));
  expect(newCardsToday(h, now)).toBe(NEW_CARDS_PER_DAY);
  expect(pickNext(deck, h, now)).toBeUndefined();
  expect(newCardsToday(h, new Date('2026-10-01T12:00:00'))).toBe(0); // a new day
});

test('nextDue is the earliest due time of the reviewed cards', () => {
  expect(nextDue(deck, history())).toBeUndefined();
  const h = history({ 'a/1': scheduled(State.Review, minutes(90)), 'b/3': scheduled(State.Learning, minutes(9)) });
  expect(nextDue(deck, h)).toEqual(minutes(9));
});

test('only the right move is Good; anything else is Again', () => {
  expect(gradeOf('win')).toBe(Rating.Good);
  expect(gradeOf('fail')).toBe(Rating.Again);
  expect(gradeOf('view')).toBe(Rating.Again);
  expect(gradeOf('skip')).toBe(Rating.Again);
});
