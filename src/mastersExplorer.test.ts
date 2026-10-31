// mastersExplorer.test.ts: checks asking Lichess's masters database, with a stand-in for Lichess.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { MasterMove } from './deck';
import { GAP, MastersExplorer } from './mastersExplorer';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const saved: Record<string, MasterMove[]> = { [START]: [{ uci: 'e2e4', white: 5, draws: 3, black: 2 }] };

let asked: { url: URL; auth: string }[];
let answers: Response[];
const lichessSays = () =>
  Response.json({ white: 1, moves: [{ uci: 'c7c5', san: 'c5', white: 9, draws: 4, black: 7, averageRating: 2500 }] });
beforeEach(() => {
  asked = [];
  answers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init: RequestInit) => {
      asked.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return answers.shift() ?? lichessSays();
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const explorer = (token?: string) => {
  const saves: [string, MasterMove[]][] = [];
  const waits: number[] = [];
  const e = new MastersExplorer({ ...saved }, token, (fen, moves) => void saves.push([fen, moves]), async ms => void waits.push(ms));
  return { e, saves, waits };
};

test('a saved answer asks Lichess nothing', async () => {
  const { e } = explorer('lio_T');
  expect(await e.moves(START)).toEqual(saved[START]);
  expect(asked).toEqual([]);
});

test('a new position: one request, with your token and without the games, and the answer saved', async () => {
  const { e, saves } = explorer('lio_T');
  const moves = await e.moves(E4);
  expect(moves).toEqual([{ uci: 'c7c5', white: 9, draws: 4, black: 7 }]); // only what's used
  expect(asked).toHaveLength(1);
  expect(asked[0].url.origin + asked[0].url.pathname).toBe('https://explorer.lichess.org/masters');
  expect(Object.fromEntries(asked[0].url.searchParams)).toEqual({ fen: E4, topGames: '0' });
  expect(asked[0].auth).toBe('Bearer lio_T');
  expect(saves).toEqual([[E4, moves]]);
  await e.moves(E4);
  expect(asked).toHaveLength(1);
});

test('without a token, a new position is skipped: no request, nothing saved, and its card kept as it is', async () => {
  const { e, saves } = explorer(undefined);
  expect(await e.moves(E4)).toEqual([]);
  expect(asked).toEqual([]);
  expect(saves).toEqual([]);
  expect(await e.moves(START)).toEqual(saved[START]); // saved answers still count
});

test('requests at least 3 seconds apart; on "too many requests", a minute\'s wait and one more try, then it stops', async () => {
  const { e, waits } = explorer('lio_T');
  await e.moves(E4);
  await e.moves('8/8/8/8/8/8/8/K6k w - - 0 1');
  expect(waits[0]).toBe(0); // the first goes at once
  expect(waits[1]).toBeGreaterThan(GAP - 1000); // the next waits for the rest of the 3 seconds
  answers = [new Response(null, { status: 429 })];
  await e.moves('8/8/8/8/8/8/8/K5k1 w - - 0 1');
  expect(waits).toContain(60_000);
  answers = [new Response(null, { status: 429 }), new Response(null, { status: 429 })];
  await expect(e.moves('8/8/8/8/8/8/8/K4k2 w - - 0 1')).rejects.toThrow('Lichess asked to slow down again (429).');
});
