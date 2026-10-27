// compare.test.ts: checks the comparison page's sums (compare.ts). (analysisRun.test.ts checks its
// run of analyses.)
import { expect, test } from 'vitest';

import real1 from '../fixtures/real1.json';
import { compareGame, CompareCtrl, totals } from './compare';
import { cardsOfGame, mistakeOf, type MasterMove } from './deck';
import type { LichessGameJson } from './tree';

const game = real1 as unknown as LichessGameJson; // your cards: 20.Qh4 (ply 39), and plies 41 and 63
const masterMove = (uci: string, games: number): MasterMove => ({ uci, white: games, draws: 0, black: 0 });

test("Lichess's analysis compared with itself: everything the same", () => {
  const c = compareGame(game, game.analysis!, 'white', {});
  expect(c.cards.map(r => [r.ply, r.lichess, r.local, r.masters])).toEqual([
    [39, true, true, undefined],
    [41, true, true, undefined],
    [63, true, true, undefined],
  ]);
  expect(c.cards[0].move).toBe('20. Qh4');
  expect(c.judgments).toEqual({ same: 11, different: 0, lichessOnly: 0, localOnly: 0 });
  expect(c.evalDifferences.every(d => d === 0)).toBe(true);
});

test("a card only one analysis gives, and the masters database's say in the opening", () => {
  const opening = { ...game, division: { middle: 50 } }; // as if plies 39 and 41 were in the opening
  const [qh4] = cardsOfGame(opening, 'white');
  const masters = { [mistakeOf(opening, qh4).fen]: [masterMove('h6h4', 2)] }; // masters played 20.Qh4
  // Our analysis, without the judgment of ply 41.
  const local = game.analysis!.map((e, i) => (i === 40 ? { eval: e.eval, mate: e.mate } : e));
  const c = compareGame(opening, local, 'white', masters);
  expect(c.cards.map(r => [r.ply, r.lichess, r.local, r.masters])).toEqual([
    [39, true, true, 'book'], // neither keeps it
    [41, true, false, 'unknown'], // not looked up yet
    [63, true, true, undefined], // not in the opening
  ]);
  expect(c.judgments).toEqual({ same: 10, different: 0, lichessOnly: 1, localOnly: 0 });
  expect(totals([c]).cards).toEqual({ same: 1, lichessOnly: 1, localOnly: 0, book: 1, unknown: 1 });
});

test('the page compares each game analysed here so far', () => {
  const games = ['a', 'b', 'c'].map(id => ({ ...game, id }));
  const saved = { a: { analysis: game.analysis!, engine: 'Stockfish 19', nodes: 1_000_000, at: '' } };
  const ctrl = new CompareCtrl('mugglesman1982', games, saved, {}, () => {});
  expect(ctrl.comparisons().map(c => [c.game.id, totals([c]).cards.same])).toEqual([['a', 3]]);
  expect(ctrl.waiting().map(g => g.id)).toEqual(['b', 'c']);
});
