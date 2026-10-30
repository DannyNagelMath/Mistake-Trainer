// settings.ts: Not in lila. Your settings, which you change in Training settings: which games make
// cards, which new cards come first, and how cards are scheduled. schedule.ts reads them, and
// storage.ts keeps them, like your review history. With none saved, everything is at its default,
// and anything missing or out of range is too.

import { speeds, type Speed } from './gameDownload';
import { povChances } from './winningChances';

// Which new cards come first, among those not yet started:
//   'collapses': positions where your move turned a win or a level game into a loss (isCollapse);
//   'recent': from your latest games first;
//   'openings': from the opening (move openingMoves or earlier) first;
//   'random': no preference.
// Whatever the order, positions that were already won come last (isAlreadyWon in schedule.ts).
export type NewCardOrder = 'collapses' | 'recent' | 'openings' | 'random';
export const newCardOrders: NewCardOrder[] = ['collapses', 'recent', 'openings', 'random'];

export interface Settings {
  // The kinds of your games (by time control) that are downloaded and make cards, in Lichess's order.
  gameTypes: Speed[];
  // New cards
  // New cards only come from your latest games with computer analysis, this many; null for all.
  // The cards you've started keep coming back, whatever their game (schedule.ts cardsInPlay).
  recentGames: number | null;
  newCardOrder: NewCardOrder;
  newCardsPerDay: number | null; // at most this many new cards in any 24 hours; null for no limit
  // A collapse: the eval before your move was better than collapseBefore, and after it, worse
  // than collapseAfter. In pawns, from your side: -2 means you're two pawns down.
  collapseBefore: number;
  collapseAfter: number;
  openingMoves: number; // a card is from the opening if its move is this one or earlier
  // Reviews
  desiredRetention: number; // FSRS's aim: your chance of still getting a card right when it's due
  minGapDays: number; // no card comes back sooner than this after a review
  gameRestDays: number; // after you review a card, the other cards from its game wait this long
  // Answers
  bestMoveOnly: boolean; // only the analysis's best move counts as right (and master moves, checkmates)
}

export const defaultSettings: Settings = {
  gameTypes: ['blitz', 'rapid'],
  recentGames: null, // all your games
  newCardOrder: 'collapses',
  newCardsPerDay: null, // no limit: you do as many as you get around to
  collapseBefore: -1.1,
  collapseAfter: -2,
  openingMoves: 12,
  desiredRetention: 0.9, // ts-fsrs's default
  minGapDays: 7,
  gameRestDays: 1,
  bestMoveOnly: false, // any move nearly as good counts, as on Lichess
};

export type NumberKey = Exclude<keyof Settings, 'gameTypes' | 'newCardOrder' | 'bestMoveOnly'>;

// What each number can be. Retention near 1 makes the reviews pile up, as FSRS then schedules
// every card very soon; much below 0.7 you'd forget most cards before seeing them again. The
// minimum gap starts at 1 day because FSRS never schedules a card sooner than that anyway.
export const ranges: Record<NumberKey, { min: number; max: number; whole?: boolean }> = {
  recentGames: { min: 1, max: 100_000, whole: true },
  newCardsPerDay: { min: 1, max: 1000, whole: true },
  collapseBefore: { min: -10, max: 10 },
  collapseAfter: { min: -10, max: 10 },
  openingMoves: { min: 1, max: 60, whole: true },
  desiredRetention: { min: 0.7, max: 0.97 },
  minGapDays: { min: 1, max: 90, whole: true },
  gameRestDays: { min: 0, max: 30, whole: true },
};

export type Problems = Partial<Record<keyof Settings, string>>;

// What's wrong with each setting that's wrong, as a message for the settings page; {} if nothing is.
export function problems(s: Settings): Problems {
  const found: Problems = {};
  if (!Array.isArray(s.gameTypes) || !s.gameTypes.length || s.gameTypes.some(t => !speeds.includes(t)))
    found.gameTypes = 'Choose at least one';
  if (!newCardOrders.includes(s.newCardOrder)) found.newCardOrder = 'Choose one of the orders';
  if (typeof s.bestMoveOnly !== 'boolean') found.bestMoveOnly = 'On or off';
  for (const key of Object.keys(ranges) as NumberKey[]) {
    const value = s[key];
    const { min, max, whole } = ranges[key];
    if ((key === 'newCardsPerDay' || key === 'recentGames') && value === null) continue; // no limit
    if (typeof value !== 'number' || !(value >= min && value <= max) || (whole && !Number.isInteger(value)))
      found[key] = `${whole ? 'A whole number' : 'A number'} from ${min} to ${max}`;
  }
  if (!found.collapseBefore && !found.collapseAfter && s.collapseAfter >= s.collapseBefore)
    found.collapseAfter = 'Must be below the eval before the move';
  return found;
}

// `s`, with each wrong setting replaced by the one in `fallback`. A collapse needs both its evals
// to make sense together, so if either is wrong, both are replaced.
export function fixProblems(s: Settings, fallback: Settings): Settings {
  const fixed = { ...s } as Record<keyof Settings, unknown>;
  const wrong = Object.keys(problems(s)) as (keyof Settings)[];
  if (wrong.includes('collapseBefore') || wrong.includes('collapseAfter')) wrong.push('collapseBefore', 'collapseAfter');
  for (const key of wrong) fixed[key] = fallback[key];
  return fixed as Settings;
}

// The settings in `raw` (what's saved), with the default for anything missing
// or wrong, so a file from an older version, or edited by hand, still works.
export function parseSettings(raw: unknown): Settings {
  const given = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const s = { ...defaultSettings } as Record<keyof Settings, unknown>;
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) if (key in given) s[key] = given[key];
  const fixed = fixProblems(s as Settings, defaultSettings);
  return { ...fixed, gameTypes: speeds.filter(t => fixed.gameTypes.includes(t)) }; // in Lichess's order, as the form has them
}

// An eval in pawns, from your side, as winning chances from -1 to 1, the way cards store them
// (Card.chancesBefore and chancesAfter): lila's formula, for White, who sees evals as they are.
export const pawnsToChances = (pawns: number): number => povChances('white', { cp: pawns * 100 });
