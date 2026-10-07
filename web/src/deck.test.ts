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
  expect(card).toMatchObject({ id: 'oLSivxSu/39', gameId: 'oLSivxSu', ply: 39, color: 'white' });
});

test('a card knows your winning chances before and after the mistake, its move, and when it was played', () => {
  const [qh4] = cardsOfGame(fixture('real1'), 'white'); // 20.Qh4?? gave up a forced mate...
  expect(qh4).toMatchObject({ moveNumber: 20, playedAt: fixture('real1').createdAt });
  expect([qh4.chancesBefore, qh4.chancesAfter]).toEqual([0.997, -0.364]); // ...for -2.1
  const [bg7] = cardsOfGame(fixture('real1'), 'black'); // 19...Bg7?? from +1.3 allowed mate
  expect([bg7.moveNumber, bg7.chancesBefore, bg7.chancesAfter]).toEqual([19, 0.242, -0.997]);
});
