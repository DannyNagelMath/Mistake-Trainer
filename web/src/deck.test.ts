// deck.test.ts: Step 9. Checks that the deck finds the same mistakes as "Learn from your mistakes".
// The expected plies are the ones scripts/checkRetro.ts reports for these games.
import { expect, test } from 'vitest';

import real1 from '../fixtures/real1.json';
import real2 from '../fixtures/real2.json';
import real3 from '../fixtures/real3.json';
import { cardsOfGame, colorOf } from './deck';
import type { LichessGameJson } from './tree';

const fixtures: Record<string, unknown> = { real1, real2, real3 };
const fixture = (name: string): LichessGameJson => fixtures[name] as LichessGameJson;

test('colorOf finds your color from your username, in any case', () => {
  const game = fixture('real1');
  expect(colorOf(game, 'mugglesman1982')).toBe('white');
  expect(colorOf(game, 'MugglesMan1982')).toBe('white');
  expect(colorOf(game, 'RealAgentCooper')).toBe('black');
  expect(colorOf(game, 'someone-else')).toBeUndefined();
});

test('cardsOfGame finds the same mistakes as retroCtrl', () => {
  expect(cardsOfGame(fixture('real1'), 'white').map(c => c.ply)).toEqual([39, 41, 63]);
  expect(cardsOfGame(fixture('real1'), 'black').map(c => c.ply)).toEqual([38, 62, 66, 74]);
  expect(cardsOfGame(fixture('real2'), 'white').map(c => c.ply)).toEqual([25, 35]);
  expect(cardsOfGame(fixture('real3'), 'black').map(c => c.ply)).toEqual([28, 38, 70]);
});

test('a card id is the game id and the ply', () => {
  const [card] = cardsOfGame(fixture('real1'), 'white');
  expect(card).toEqual({ id: 'oLSivxSu/39', gameId: 'oLSivxSu', ply: 39, color: 'white' });
});
