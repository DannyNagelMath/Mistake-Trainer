// schedule.test.ts: Step 9. Checks which card schedule.ts picks next.
import { createEmptyCard, Rating, State, type CardInput, type Grade } from 'ts-fsrs';
import { expect, test } from 'vitest';

import type { Card } from './deck';
import type { ReviewEntry, ReviewHistory } from './reviews';
import {
  canComeUp,
  cardsInPlay,
  cardsLeft,
  gradeOf,
  isCollapse,
  isOpening,
  newCardsInLastDay,
  nextAvailable,
  pickNext,
  progress,
  recentGames,
  reviewCard,
  scheduler,
  orderNewCards,
  winRatings,
  withMinimumGap,
  yourLastGames,
} from './schedule';
import { defaultSettings, pawnsToChances, type Settings } from './settings';

const now = new Date('2026-09-30T12:00:00');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

const s = defaultSettings; // the settings the page starts with: no new-card limit, a 7-day gap
const LIMIT = 5; // a new-card limit, for the tests that check one
const limited: Settings = { ...s, newCardsPerDay: LIMIT };

// A card; by default not a collapse, not already won, and not from the opening.
const card = (id: string, more: Partial<Card> = {}): Card => ({
  id,
  gameId: id.split('/')[0],
  ply: Number(id.split('/')[1]),
  color: 'white',
  chancesBefore: 0,
  chancesAfter: -0.3,
  moveNumber: 20,
  playedAt: 0,
  ...more,
});
const deck = ['a/1', 'b/3', 'c/5', 'd/7'].map(id => card(id));

// A schedule in the given state, due at the given time.
const scheduled = (state: State, due: Date): CardInput => ({ ...createEmptyCard(now), state, due });

const history = (cards: Record<string, CardInput> = {}, log: ReviewEntry[] = []): ReviewHistory => ({ cards, log });

// A log entry: the card reviewed at `at`, in `state` before the review. Only what schedule.ts reads.
const reviewed = (cardId: string, at: Date, state = State.Review): ReviewEntry =>
  ({ cardId, result: 'win', log: { state, review: at } }) as unknown as ReviewEntry;

test('with no history, new cards come in deck order', () => {
  expect(pickNext(deck, history(), now, s)?.id).toBe('a/1');
  expect(cardsLeft(deck, history(), now, s)).toBe(4);
});

test('cards that are due come before new ones, the most overdue first', () => {
  const h = history({
    'c/5': scheduled(State.Review, minutes(-60)),
    'b/3': scheduled(State.Review, minutes(-600)),
  });
  expect(pickNext(deck, h, now, s)?.id).toBe('b/3');
  expect(cardsLeft(deck, h, now, s)).toBe(4); // 2 due + 2 new
});

test("cards that aren't due yet wait", () => {
  const h = history({ 'a/1': scheduled(State.Review, minutes(60 * 24)) });
  expect(pickNext(deck, h, now, s)?.id).toBe('b/3');
  expect(cardsLeft(deck, h, now, s)).toBe(3);
});

test('cards left in Learning or Relearning by the old steps wait until they are due, like any other', () => {
  const soon = history({
    'a/1': scheduled(State.Learning, minutes(5)),
    'b/3': scheduled(State.Relearning, minutes(15)),
    'c/5': scheduled(State.Review, minutes(10)),
  });
  expect(pickNext(deck, soon, now, s)?.id).toBe('d/7'); // the only new card; nothing comes early
  expect(cardsLeft(deck, soon, now, s)).toBe(1);
  expect(pickNext(deck, soon, minutes(6), s)?.id).toBe('a/1'); // once it's due
});

// The scheduler: every answer puts the card at least a day out, in the Review state.
const atLeastADay = (due: Date, from: Date) => due.getTime() - from.getTime() >= 24 * 60 * 60_000;
const grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

test('a new card comes back at least a day later, whatever the answer', () => {
  for (const grade of grades) {
    const { card } = scheduler(s).next(createEmptyCard(now), now, grade);
    expect(card.state).toBe(State.Review);
    expect(atLeastADay(card.due, now)).toBe(true);
  }
});

test('a forgotten card comes back a day later, not in minutes', () => {
  const learnt = scheduler(s).next(scheduler(s).next(createEmptyCard(now), now, Rating.Good).card, minutes(60 * 48), Rating.Good).card;
  const reviewedAt = new Date(learnt.due);
  const { card } = scheduler(s).next(learnt, reviewedAt, Rating.Again);
  expect(card.state).toBe(State.Review);
  expect(atLeastADay(card.due, reviewedAt)).toBe(true);
});

test('a card left in Learning or Relearning by the old steps moves to Review, at least a day out', () => {
  for (const state of [State.Learning, State.Relearning])
    for (const grade of grades) {
      const { card } = scheduler(s).next({ ...scheduled(state, minutes(-1)), stability: 0.5, difficulty: 5, reps: 1 }, now, grade);
      expect(card.state).toBe(State.Review);
      expect(atLeastADay(card.due, now)).toBe(true);
    }
});

test('the card just shown only comes again when there is no other', () => {
  expect(pickNext(deck, history(), now, s, 'a/1')?.id).toBe('b/3');
  const tomorrow = scheduled(State.Review, minutes(60 * 24));
  const onlyA = history({ 'b/3': tomorrow, 'c/5': tomorrow, 'd/7': tomorrow }); // a/1 is the only new card
  expect(pickNext(deck, onlyA, now, s, 'a/1')?.id).toBe('a/1');
});

test('a new-card limit counts any 24 hours, not a calendar day', () => {
  // LIMIT new cards started an hour ago, from games not in the deck
  const log = Array.from({ length: LIMIT }, (_, i) => reviewed(`x${i}/1`, minutes(-60), State.New));
  const h = history({}, log);
  expect(newCardsInLastDay(h, now)).toBe(LIMIT);
  expect(pickNext(deck, h, now, limited)).toBeUndefined();
  expect(pickNext(deck, h, minutes(60 * 23 - 1), limited)).toBeUndefined(); // past midnight, within 24 hours
  expect(newCardsInLastDay(h, minutes(60 * 23))).toBe(0); // 24 hours after they were started
  expect(pickNext(deck, h, minutes(60 * 23), limited)?.id).toBe('a/1');
});

test('with no new-card limit, the default, every new card can come up', () => {
  const log = Array.from({ length: 50 }, (_, i) => reviewed(`x${i}/1`, minutes(-60), State.New));
  expect(pickNext(deck, history({}, log), now, s)?.id).toBe('a/1');
  expect(cardsLeft(deck, history({}, log), now, s)).toBe(4);
});

// Two more cards from game g, and one from game h.
const gameDeck = ['g/1', 'g/3', 'g/5', 'h/7'].map(id => card(id));

test("after a card from a game is reviewed, the game's other cards wait 24 hours", () => {
  const h = history(
    {
      'g/1': scheduled(State.Review, minutes(60 * 47)), // reviewed an hour ago
      'g/3': scheduled(State.Review, minutes(-10)), // due, but from the same game
    },
    [reviewed('g/1', minutes(-60))],
  );
  expect(pickNext(deck, h, now, s)?.id).toBe('a/1'); // games a to d aren't affected
  expect(pickNext(gameDeck, h, now, s)?.id).toBe('h/7'); // not g/3, nor the new g/5
  expect(cardsLeft(gameDeck, h, now, s)).toBe(1);
  expect(pickNext(gameDeck, h, minutes(60 * 23 - 1), s)?.id).toBe('h/7'); // still within 24 hours
  expect(pickNext(gameDeck, h, minutes(60 * 23), s)?.id).toBe('g/3'); // 24 hours after the review
});

test('waiting games only affect the queue, not the FSRS schedules', () => {
  const h = history(
    { 'g/1': scheduled(State.Review, minutes(60 * 47)), 'g/3': scheduled(State.Review, minutes(-10)) },
    [reviewed('g/1', minutes(-60))],
  );
  const before = JSON.stringify(h);
  pickNext(gameDeck, h, now, s);
  cardsLeft(gameDeck, h, now, s);
  nextAvailable(gameDeck, h, now, s);
  expect(JSON.stringify(h)).toBe(before);
});

test('nextAvailable is when the next card can come up', () => {
  // new cards can come up at once
  expect(nextAvailable(deck, history(), now, s)).toEqual(now);
  // with every card reviewed: the earliest due time
  const due = (n: number) => scheduled(State.Review, minutes(n));
  expect(nextAvailable(deck, history({ 'a/1': due(90), 'b/3': due(9), 'c/5': due(300), 'd/7': due(200) }), now, s)).toEqual(
    minutes(9),
  );
  // a due card from a waiting game: when the game stops waiting
  const onlyG = ['g/1', 'g/3'].map(id => card(id));
  const waiting = history({ 'g/1': due(60 * 47), 'g/3': due(-10) }, [reviewed('g/1', minutes(-60))]);
  expect(nextAvailable(onlyG, waiting, now, s)).toEqual(minutes(60 * 23));
  // new cards with a limit reached: when the oldest of the last 24 hours' new cards is 24 hours old
  const log = Array.from({ length: LIMIT }, (_, i) => reviewed(`x${i}/1`, minutes(-60 + i), State.New));
  expect(nextAvailable(deck, history({}, log), now, limited)).toEqual(minutes(60 * 23));
  expect(nextAvailable(deck, history({}, log), now, s)).toEqual(now); // with no limit, at once
});

test('after the right first move, the buttons give Hard, Good, and Easy', () => {
  expect(winRatings.map(r => [r.label, r.grade])).toEqual([
    ['Worked it out', Rating.Hard],
    ['Looked familiar', Rating.Good],
    ['Knew it instantly', Rating.Easy],
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
  expect(pickNext(deck, h, now, s)?.id).toBe('c/5'); // not the due b/3, nor the new a/1
  expect(cardsLeft(deck, h, now, s)).toBe(2); // c/5 and d/7
  const onlySuspended = history({ 'a/1': scheduled(State.Review, minutes(30)) });
  onlySuspended.suspended = { 'a/1': now.toISOString() };
  expect(nextAvailable([card('a/1')], onlySuspended, now, s)).toBeUndefined();
});

test('the progress box counts started, not started, and suspended cards, and those due now', () => {
  const h = history({
    'a/1': scheduled(State.Review, minutes(60 * 24 * 10)), // started, and due in 10 days
    'b/3': scheduled(State.Review, minutes(-10)), // started, and due
  });
  h.suspended = { 'd/7': now.toISOString() };
  expect(progress(deck, h, now, s)).toMatchObject({ started: 2, notStarted: 1, suspended: 1, dueNow: 1 });
});

test('the progress box says when the next started cards come up, and how many that day', () => {
  const inTenDays = minutes(60 * 24 * 10);
  const h = history({
    'a/1': scheduled(State.Review, inTenDays),
    'b/3': scheduled(State.Review, minutes(60 * 24 * 10 + 30)), // the same day, half an hour later
    'c/5': scheduled(State.Review, minutes(60 * 24 * 12)), // two days later
  });
  expect(progress(deck, h, now, s)).toMatchObject({ dueNow: 0, nextDue: { at: inTenDays.getTime(), count: 2 } });
  expect(progress(deck, history(), now, s).nextDue).toBeUndefined(); // nothing started yet
});

test('no card comes back within 7 days of a review, whatever the answer; FSRS keeps its own interval', () => {
  const days = (d: Date) => (d.getTime() - now.getTime()) / (24 * 60 * 60_000);
  const results = grades.map(grade => reviewCard(createEmptyCard(now), now, grade, s).card);
  expect(results.map(c => days(c.due))).toEqual([7, 7, 7, 8]); // Again, Hard, Good: 7; Easy: FSRS's 8
  expect(results.map(c => c.scheduled_days)).toEqual([1, 1, 2, 8]); // FSRS's intervals, unchanged
  expect(withMinimumGap(minutes(60 * 24 * 40), now, 7)).toEqual(minutes(60 * 24 * 40)); // later dates stay
});

test('new cards: collapses first by default, already-won positions always last, ties in deck order', () => {
  const cards = [
    card('a/1'), // an ordinary mistake
    card('b/3', { chancesBefore: 0.9, chancesAfter: 0.6, playedAt: 3 }), // already won
    card('c/5', { chancesBefore: 0.1, chancesAfter: -0.7, playedAt: 1 }), // a collapse
    card('d/7', { moveNumber: 9, playedAt: 2 }), // an opening mistake
    card('e/9', { chancesBefore: -0.1, chancesAfter: -0.9 }), // another collapse
  ];
  const ids = (newCardOrder: Settings['newCardOrder']) => orderNewCards(cards, { ...s, newCardOrder }).map(c => c.id);
  expect(ids('collapses')).toEqual(['c/5', 'e/9', 'a/1', 'd/7', 'b/3']);
  expect(ids('openings')).toEqual(['d/7', 'a/1', 'c/5', 'e/9', 'b/3']);
  expect(ids('recent')).toEqual(['d/7', 'c/5', 'a/1', 'e/9', 'b/3']);
  expect(ids('random')).toEqual(['a/1', 'c/5', 'd/7', 'e/9', 'b/3']);
  expect(pickNext(orderNewCards(cards, s), history(), now, s)?.id).toBe('c/5'); // collapses first by default
});

// ---------- Settings (settings.ts), from the settings page ----------

test('the collapse thresholds, in pawns, are about the winning chances they replaced', () => {
  expect(pawnsToChances(-1.1)).toBeCloseTo(-0.2, 2);
  expect(pawnsToChances(-2)).toBeCloseTo(-0.35, 2);
  expect(pawnsToChances(0)).toBe(0);
});

test('what counts as a collapse or an opening mistake follows the settings', () => {
  const lost = card('a/1', { chancesBefore: 0, chancesAfter: -0.3 }); // level, then about -1.7
  expect(isCollapse(lost, s)).toBe(false); // not worse than -2
  expect(isCollapse(lost, { ...s, collapseAfter: -1.5 })).toBe(true);
  expect(isCollapse(lost, { ...s, collapseBefore: 0.5, collapseAfter: -1.5 })).toBe(false); // not better than +0.5 before
  const move15 = card('b/29', { moveNumber: 15 });
  expect(isOpening(move15, s)).toBe(false);
  expect(isOpening(move15, { ...s, openingMoves: 15 })).toBe(true);
});

test("the minimum gap follows the settings; at its lowest, 1 day, FSRS's own dates stand", () => {
  const days = (d: Date) => (d.getTime() - now.getTime()) / (24 * 60 * 60_000);
  const dueIn = (grade: Grade, minGapDays: number) =>
    days(reviewCard(createEmptyCard(now), now, grade, { ...s, minGapDays }).card.due);
  expect(dueIn(Rating.Again, 3)).toBe(3);
  expect(grades.map(grade => dueIn(grade, 1))).toEqual([1, 1, 2, 8]); // Again to Easy: FSRS's own
});

test('a higher desired retention brings a card back sooner', () => {
  const gapAfterTwoGoods = (desiredRetention: number) => {
    const settings = { ...s, desiredRetention, minGapDays: 1 };
    const first = reviewCard(createEmptyCard(now), now, Rating.Good, settings).card;
    return reviewCard(first, new Date(first.due), Rating.Good, settings).card.scheduled_days;
  };
  expect(gapAfterTwoGoods(0.95)).toBeLessThan(gapAfterTwoGoods(0.9));
  expect(gapAfterTwoGoods(0.9)).toBeLessThan(gapAfterTwoGoods(0.8));
});

test('canComeUp: a card you left can come back if it could be dealt now', () => {
  const h = history(
    { 'a/1': scheduled(State.Review, minutes(-10)), 'b/3': scheduled(State.Review, minutes(60)) },
    [reviewed('g/9', minutes(-60))], // a game reviewed an hour ago: its cards wait
  );
  h.suspended = { 'c/5': now.toISOString() };
  const cards = [...deck, card('g/1')];
  expect(canComeUp(cards, h, now, s, 'a/1')).toBe(true); // due
  expect(canComeUp(cards, h, now, s, 'b/3')).toBe(false); // not due yet: e.g. you'd answered it
  expect(canComeUp(cards, h, now, s, 'c/5')).toBe(false); // suspended
  expect(canComeUp(cards, h, now, s, 'd/7')).toBe(true); // new
  expect(canComeUp(cards, h, now, s, 'g/1')).toBe(false); // its game is waiting
  expect(canComeUp(cards, h, now, s, 'z/1')).toBe(false); // not in the deck
  const fullDay = Array.from({ length: LIMIT }, (_, i) => reviewed(`x${i}/1`, minutes(-60), State.New));
  expect(canComeUp(cards, history({}, fullDay), now, limited, 'd/7')).toBe(false); // the new-card limit is reached
});

test("how long a game's other cards wait follows the settings: here 3 days, and 0 for no wait", () => {
  const h = history({ 'g/3': scheduled(State.Review, minutes(-10)) }, [reviewed('g/1', minutes(-60 * 30))]); // 30 hours ago
  const cards = [card('g/3')];
  expect(pickNext(cards, h, now, s)?.id).toBe('g/3'); // a day's wait is over
  expect(pickNext(cards, h, now, { ...s, gameRestDays: 3 })).toBeUndefined(); // three days' isn't
  expect(nextAvailable(cards, h, now, { ...s, gameRestDays: 3 })).toEqual(minutes(-60 * 30 + 3 * 24 * 60));
  const justNow = history({ 'g/3': scheduled(State.Review, minutes(-10)) }, [reviewed('g/1', minutes(-1))]);
  expect(pickNext(cards, justNow, now, { ...s, gameRestDays: 0 })?.id).toBe('g/3');
});

test('"Recent games": new cards only from your latest games; started and suspended cards stay in play', () => {
  // Four games, a/1 the newest, each started a day before the one after it.
  const day = 24 * 60 * 60_000;
  const games = ['a/1', 'b/3', 'c/5', 'd/7'].map((id, i) => card(id, { playedAt: 10 * day - i * day }));
  const times = games.map(c => c.playedAt);
  const ids = (cards: Card[]) => cards.map(c => c.id);
  expect(recentGames(times, { ...s, recentGames: 2 })).toEqual({ games: 2, since: 9 * day });
  expect(ids(cardsInPlay(games, history(), times, { ...s, recentGames: 2 }))).toEqual(['a/1', 'b/3']);
  // d/7, from the oldest game, was started, and c/5 suspended: both stay.
  const h = { ...history({ 'd/7': scheduled(State.Review, minutes(-1)) }), suspended: { 'c/5': now.toISOString() } };
  const inPlay = cardsInPlay(games, h, times, { ...s, recentGames: 2 });
  expect(ids(inPlay)).toEqual(['a/1', 'b/3', 'c/5', 'd/7']);
  expect(pickNext(inPlay, h, now, s)?.id).toBe('d/7'); // due, so it comes first, whatever its game
  expect(progress(inPlay, h, now, s)).toMatchObject({ started: 1, notStarted: 2, suspended: 1 });
  // Empty, or as many games as you have or more: all of them.
  for (const recent of [null, 4, 10]) {
    expect(recentGames(times, { ...s, recentGames: recent })).toBeUndefined();
    expect(cardsInPlay(games, history(), times, { ...s, recentGames: recent })).toBe(games);
  }
  expect(yourLastGames(1)).toBe('your last game');
  expect(yourLastGames(100)).toBe('your last 100 games');
});
