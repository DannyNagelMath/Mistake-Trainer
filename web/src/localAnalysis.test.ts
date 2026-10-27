// localAnalysis.test.ts: checks that an analysis made on your computer comes out as Lichess's would,
// from the same evaluations. Stockfish needs a browser, so a stand-in answers for it.
import { INITIAL_FEN } from 'chessops/fen';
import { beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import type { EngineEval } from './engine';
import { analyseGame, toEntries, type Info } from './localAnalysis';
import type { LichessGameJson } from './tree';

// The stand-in for engine.ts: for a position (the number of moves played to get there), the
// evaluation and line a test gives it, or else 0 and no line.
const engine = vi.hoisted(() => ({ answers: {} as Record<number, Partial<EngineEval>> }));
const searchGamePosition = vi.hoisted(() =>
  vi.fn(async (_rootFen: string, moves: string[], _newGame: boolean) => ({
    depth: 20,
    nodes: 1000000,
    millis: 900,
    ...(engine.answers[moves.length] ?? { cp: 0 }),
  })),
);
vi.mock('./engine', () => ({ searchGamePosition }));
beforeEach(() => {
  engine.answers = {};
  searchGamePosition.mockClear();
});

const game = (moves: string): LichessGameJson => ({ id: 'test', moves });

test("from Lichess's evaluations and lines, the judgments come out exactly as Lichess's", () => {
  const { analysis } = real1 as unknown as LichessGameJson;
  const infos: Info[] = analysis!.map((e, i) => ({
    ply: i + 1,
    cp: e.eval,
    mate: e.mate,
    variation: e.variation ? [e.best!] : [],
    sans: e.variation ? e.variation.split(' ') : [],
  }));
  expect(toEntries(infos).map(e => e.judgment)).toEqual(analysis!.map(e => e.judgment));
  expect(analysis!.filter(e => e.judgment)).toHaveLength(11); // this game's inaccuracies, mistakes, and blunders
});

test('a game is searched from its last position to its first; the checkmate at the end is not', async () => {
  // 3...Nf6?? walks into 4.Qxf7#, when 3...g6 was fine.
  engine.answers[5] = { cp: 30, pv: ['g7g6', 'h5f3', 'g8f6'] }; // after 3.Qh5, Black to move
  engine.answers[6] = { mate: 1, pv: ['h5f7'] }; // after 3...Nf6: White mates in one
  const progress: number[] = [];
  const entries = await analyseGame(game('e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#'), done => progress.push(done));
  expect(searchGamePosition.mock.calls.map(([rootFen, moves, newGame]) => [rootFen, moves.length, newGame])).toEqual([
    [INITIAL_FEN, 6, true], // with an empty memory to start with
    ...[5, 4, 3, 2, 1, 0].map(n => [INITIAL_FEN, n, false]),
  ]);
  expect(searchGamePosition.mock.calls[0][1]).toEqual(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6']);
  expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // eight positions, the last one not searched
  // As in Lichess's analysis, the move that gives checkmate has nothing said about it.
  expect(entries).toEqual([
    { eval: 0 },
    { eval: 0 },
    { eval: 0 },
    { eval: 0 },
    { eval: 30 },
    {
      mate: 1,
      best: 'g7g6',
      variation: 'g6 Qf3 Nf6',
      judgment: { name: 'Blunder', comment: 'Checkmate is now unavoidable. g6 was best.' },
    },
  ]);
});

test('aborting stops the analysis before its next search', async () => {
  const abort = new AbortController();
  const analysis = analyseGame(game('e4 e5 Nf3'), done => done === 2 && abort.abort(), abort.signal);
  await expect(analysis).rejects.toThrow();
  expect(searchGamePosition).toHaveBeenCalledTimes(2); // of its four positions
});

test('castling goes to Stockfish as it writes it (e1g1), and comes back as chessops writes it (e1h1)', async () => {
  const italian = 'e4 e5 Nf3 Nc6 Bc4 Bc5';
  engine.answers[6] = { cp: 60, pv: ['e1g1', 'g8f6'] }; // White's best: castling
  engine.answers[7] = { cp: -100 }; // a bad move instead
  const castled = await analyseGame(game(`${italian} O-O Nf6`));
  expect(searchGamePosition.mock.calls[0][1].slice(-2)).toEqual(['e1g1', 'g8f6']); // the moves to the last position
  expect(castled[6]).toEqual({ eval: -100 }); // castling was Stockfish's best, so there's nothing to say
  const notCastled = await analyseGame(game(`${italian} d3 Nf6`));
  expect(notCastled[6]).toEqual({
    eval: -100,
    best: 'e1h1',
    variation: 'O-O Nf6',
    judgment: { name: 'Mistake', comment: 'Mistake. O-O was best.' },
  });
});
