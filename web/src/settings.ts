// settings.ts: Not in lila. The settings you change on the dashboard (dashboard.html): which new
// cards come first, and how cards are scheduled. schedule.ts reads them. They live in
// data/settings.json (gitignored), which the dev server reads and writes for the pages (see
// vite.config.ts), like your review history. With no file, everything is at its default, and
// anything missing or out of range in the file is too.

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
  // New cards
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
  masteredDays: number; // a card is mastered once FSRS's interval for it is at least this
}

export const defaultSettings: Settings = {
  newCardOrder: 'collapses',
  newCardsPerDay: null, // no limit: you do as many as you get around to
  collapseBefore: -1.1,
  collapseAfter: -2,
  openingMoves: 12,
  desiredRetention: 0.9, // ts-fsrs's default
  minGapDays: 7,
  masteredDays: 30,
};

type NumberKey = Exclude<keyof Settings, 'newCardOrder'>;

// What each number can be. Retention near 1 makes the reviews pile up, as FSRS then schedules
// every card very soon; much below 0.7 you'd forget most cards before seeing them again.
export const ranges: Record<NumberKey, { min: number; max: number; whole?: boolean }> = {
  newCardsPerDay: { min: 1, max: 1000, whole: true },
  collapseBefore: { min: -10, max: 10 },
  collapseAfter: { min: -10, max: 10 },
  openingMoves: { min: 1, max: 60, whole: true },
  desiredRetention: { min: 0.7, max: 0.97 },
  minGapDays: { min: 0, max: 90, whole: true },
  masteredDays: { min: 1, max: 3650, whole: true },
};

export type Problems = Partial<Record<keyof Settings, string>>;

// What's wrong with each setting that's wrong, as a message for the dashboard; {} if nothing is.
export function problems(s: Settings): Problems {
  const found: Problems = {};
  if (!newCardOrders.includes(s.newCardOrder)) found.newCardOrder = 'Choose one of the orders';
  for (const key of Object.keys(ranges) as NumberKey[]) {
    const value = s[key];
    const { min, max, whole } = ranges[key];
    if (key === 'newCardsPerDay' && value === null) continue; // no limit
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

// The settings in `raw` (what data/settings.json holds), with the default for anything missing
// or wrong, so a file from an older version, or edited by hand, still works.
export function parseSettings(raw: unknown): Settings {
  const given = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const s = { ...defaultSettings } as Record<keyof Settings, unknown>;
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) if (key in given) s[key] = given[key];
  return fixProblems(s as Settings, defaultSettings);
}

// An eval in pawns, from your side, as winning chances from -1 to 1, the way cards store them
// (Card.chancesBefore and chancesAfter): lila's formula, for White, who sees evals as they are.
export const pawnsToChances = (pawns: number): number => povChances('white', { cp: pawns * 100 });

export async function loadSettings(): Promise<Settings> {
  const response = await fetch('/api/settings');
  if (!response.ok) throw new Error(`Couldn't load your settings: ${response.status} ${await response.text()}`);
  // A dev server started before /api/settings existed answers with the page itself.
  if (!response.headers.get('content-type')?.includes('json'))
    throw new Error("The dev server can't load your settings. Restart it (npm run dev) so it reads vite.config.ts.");
  return parseSettings(await response.json());
}

export async function saveSettings(s: Settings): Promise<void> {
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
  if (!response.ok) throw new Error(`Couldn't save your settings: ${response.status} ${await response.text()}`);
}
