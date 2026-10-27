// localAnalysis.test.ts: checks that an analysis made on your computer comes out as Lichess's would,
// from the same evaluations. Stockfish needs a browser, so a stand-in answers for fishnet.ts.
import { INITIAL_FEN } from 'chessops/fen';
import { beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import type { EngineEval } from './engine';
import { analyseGame, toEntries, type Info } from './localAnalysis';
import type { LichessGameJson } from './tree';

// The stand-in for fishnet.ts: for each position (numbered by the moves played to get there), the
// evaluation and line a test gives it, or else 0 and no line; nothing where the game is over.
const engine = vi.hoisted(() => ({ answers: {} as Record<number, Partial<EngineEval>> }));
const searchGame = vi.hoisted(() =>
  vi.fn(
    async (
      _rootFen: string,
      _moves: string[],
      over: boolean[],
      onProgress: (done: number, total: number) => void = () => {},
      _signal?: AbortSignal,
    ) =>
      over.map((isOver, i) => {
        onProgress(i + 1, over.length);
        return isOver ? undefined : { depth: 20, nodes: 1000000, millis: 900, ...(engine.answers[i] ?? { cp: 0 }) };
      }),
  ),
);
vi.mock('./fishnet', () => ({ searchGame }));
beforeEach(() => {
  engine.answers = {};
  searchGame.mockClear();
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

test("a game's positions go to fishnet.ts by its moves in UCI; the checkmate at the end isn't searched", async () => {
  // 3...Nf6?? walks into 4.Qxf7#, when 3...g6 was fine.
  engine.answers[5] = { cp: 30, pv: ['g7g6', 'h5f3', 'g8f6'] }; // after 3.Qh5, Black to move
  engine.answers[6] = { mate: 1, pv: ['h5f7'] }; // after 3...Nf6: White mates in one
  const progress: number[] = [];
  const abort = new AbortController();
  const entries = await analyseGame(game('e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#'), done => progress.push(done), abort.signal);
  const [rootFen, moves, over, , signal] = searchGame.mock.calls[0];
  expect([rootFen, moves, over]).toEqual([
    INITIAL_FEN,
    ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7'],
    [false, false, false, false, false, false, false, true], // eight positions, the last checkmate
  ]);
  expect(signal).toBe(abort.signal); // which can stop it
  expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
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

test('castling goes to Stockfish and comes back as chessops writes it (e1h1), as fishnet has Stockfish write it', async () => {
  const italian = 'e4 e5 Nf3 Nc6 Bc4 Bc5';
  engine.answers[6] = { cp: 60, pv: ['e1h1', 'g8f6'] }; // White's best: castling
  engine.answers[7] = { cp: -100 }; // a bad move instead
  const castled = await analyseGame(game(`${italian} O-O Nf6`));
  expect(searchGame.mock.calls[0][1].slice(-2)).toEqual(['e1h1', 'g8f6']); // the game's last two moves
  expect(castled[6]).toEqual({ eval: -100 }); // castling was Stockfish's best, so there's nothing to say
  const notCastled = await analyseGame(game(`${italian} d3 Nf6`));
  expect(notCastled[6]).toEqual({
    eval: -100,
    best: 'e1h1',
    variation: 'O-O Nf6',
    judgment: { name: 'Mistake', comment: 'Mistake. O-O was best.' },
  });
});
