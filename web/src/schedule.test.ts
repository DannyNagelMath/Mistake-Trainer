// schedule.test.ts: Step 9. Checks which card schedule.ts picks next.
import { createEmptyCard, Rating, State, type CardInput } from 'ts-fsrs';
import { expect, test } from 'vitest';

import type { Card } from './deck';
import type { ReviewEntry, ReviewHistory } from './reviews';
import { cardsLeft, gradeOf, newCardsInLastDay, nextAvailable, pickNext, scheduler, winRatings } from './schedule';

const now = new Date('2026-09-30T12:00:00');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const LIMIT = 5; // a new-card limit for the tests that check one; the page has none for now

const card = (id: string): Card => ({ id, gameId: id.split('/')[0], ply: Number(id.split('/')[1]), color: 'white' });
const deck = ['a/1', 'b/3', 'c/5', 'd/7'].map(card);

// A schedule in the given state, due at the given time.
const scheduled = (state: State, due: Date): CardInput => ({ ...createEmptyCard(now), state, due });

const history = (cards: Record<string, CardInput> = {}, log: ReviewEntry[] = []): ReviewHistory => ({ cards, log });

// A log entry: the card reviewed at `at`, in `state` before the review. Only what schedule.ts reads.
const reviewed = (cardId: string, at: Date, state = State.Review): ReviewEntry =>
  ({ cardId, result: 'win', log: { state, review: at } }) as unknown as ReviewEntry;

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

test('a new-card limit counts any 24 hours, not a calendar day', () => {
  // LIMIT new cards started an hour ago, from games not in the deck
  const log = Array.from({ length: LIMIT }, (_, i) => reviewed(`x${i}/1`, minutes(-60), State.New));
  const h = history({}, log);
  expect(newCardsInLastDay(h, now)).toBe(LIMIT);
  expect(pickNext(deck, h, now, undefined, LIMIT)).toBeUndefined();
  expect(pickNext(deck, h, minutes(60 * 23 - 1), undefined, LIMIT)).toBeUndefined(); // past midnight, within 24 hours
  expect(newCardsInLastDay(h, minutes(60 * 23))).toBe(0); // 24 hours after they were started
  expect(pickNext(deck, h, minutes(60 * 23), undefined, LIMIT)?.id).toBe('a/1');
});

test('with no new-card limit, as now, every new card can come up', () => {
  const log = Array.from({ length: 50 }, (_, i) => reviewed(`x${i}/1`, minutes(-60), State.New));
  expect(pickNext(deck, history({}, log), now)?.id).toBe('a/1');
  expect(cardsLeft(deck, history({}, log), now)).toBe(4);
});

// Two more cards from game g, and one from game h.
const gameDeck = ['g/1', 'g/3', 'g/5', 'h/7'].map(card);

test("after a card from a game is reviewed, the game's other cards wait 24 hours", () => {
  const h = history(
    {
      'g/1': scheduled(State.Review, minutes(60 * 47)), // reviewed an hour ago
      'g/3': scheduled(State.Review, minutes(-10)), // due, but from the same game
    },
    [reviewed('g/1', minutes(-60))],
  );
  expect(pickNext(deck, h, now)?.id).toBe('a/1'); // games a to d aren't affected
  expect(pickNext(gameDeck, h, now)?.id).toBe('h/7'); // not g/3, nor the new g/5
  expect(cardsLeft(gameDeck, h, now)).toBe(1);
  expect(pickNext(gameDeck, h, minutes(60 * 23 - 1))?.id).toBe('h/7'); // still within 24 hours
  expect(pickNext(gameDeck, h, minutes(60 * 23))?.id).toBe('g/3'); // 24 hours after the review
});

test('waiting games only affect the queue, not the FSRS schedules', () => {
  const h = history(
    { 'g/1': scheduled(State.Review, minutes(60 * 47)), 'g/3': scheduled(State.Review, minutes(-10)) },
    [reviewed('g/1', minutes(-60))],
  );
  const before = JSON.stringify(h);
  pickNext(gameDeck, h, now);
  cardsLeft(gameDeck, h, now);
  nextAvailable(gameDeck, h, now);
  expect(JSON.stringify(h)).toBe(before);
});

test('nextAvailable is when the next card can come up', () => {
  // new cards can come up at once
  expect(nextAvailable(deck, history(), now)).toEqual(now);
  // with every card reviewed: the earliest due time
  const due = (n: number) => scheduled(State.Review, minutes(n));
  expect(nextAvailable(deck, history({ 'a/1': due(90), 'b/3': due(9), 'c/5': due(300), 'd/7': due(200) }), now)).toEqual(
    minutes(9),
  );
  // a due card from a waiting game: when the game stops waiting
  const onlyG = ['g/1', 'g/3'].map(card);
  const waiting = history({ 'g/1': due(60 * 47), 'g/3': due(-10) }, [reviewed('g/1', minutes(-60))]);
  expect(nextAvailable(onlyG, waiting, now)).toEqual(minutes(60 * 23));
  // new cards with a limit reached: when the oldest of the last 24 hours' new cards is 24 hours old
  const log = Array.from({ length: LIMIT }, (_, i) => reviewed(`x${i}/1`, minutes(-60 + i), State.New));
  expect(nextAvailable(deck, history({}, log), now, LIMIT)).toEqual(minutes(60 * 23));
  expect(nextAvailable(deck, history({}, log), now)).toEqual(now); // with no limit, at once
});

test('after the right first move, the buttons give Hard, Good, and Easy', () => {
  expect(winRatings.map(r => [r.label, r.grade])).toEqual([
    ['Worked it out', Rating.Hard],
    ['Found it quickly', Rating.Good],
    ['Obvious', Rating.Easy],
  ]);
});

test('anything but the right first move is Again; the right one is Good if you move on without choosing', () => {
  expect(gradeOf('win')).toBe(Rating.Good);
  expect(gradeOf('fail')).toBe(Rating.Again);
  expect(gradeOf('view')).toBe(Rating.Again);
  expect(gradeOf('skip')).toBe(Rating.Again);
});

test('suspended cards never come up, and are not counted', () => {
  const h = history({ 'b/3': scheduled(State.Review, minutes(-60)) });
  h.suspended = { 'b/3': now.toISOString(), 'a/1': now.toISOString() };
  expect(pickNext(deck, h, now)?.id).toBe('c/5'); // not the due b/3, nor the new a/1
  expect(cardsLeft(deck, h, now)).toBe(2); // c/5 and d/7
  const onlySuspended = history({ 'a/1': scheduled(State.Review, minutes(30)) });
  onlySuspended.suspended = { 'a/1': now.toISOString() };
  expect(nextAvailable([card('a/1')], onlySuspended, now)).toBeUndefined();
});
