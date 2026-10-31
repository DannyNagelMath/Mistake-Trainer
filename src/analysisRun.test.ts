// analysisRun.test.ts: checks a run of analyses (analysisRun.ts), with stand-ins for the analysis
// (which needs Stockfish, so a browser) and for saving.
import { expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import { AnalysisRun } from './analysisRun';
import type { LichessGameJson } from './tree';

// The stand-in analysis gives the game's own analysis back, after telling the test which game it's
// on (to pause there, say), as a run of two positions. A game without moves can't be analysed.
const run = vi.hoisted(() => ({ onGame: (_id: string) => {} }));
vi.mock('./localAnalysis', () => ({
  analyseGame: async (game: LichessGameJson, onProgress: (done: number, total: number) => void, signal?: AbortSignal) => {
    if (!game.moves) throw new Error('no moves');
    onProgress(1, 2);
    run.onGame(game.id);
    signal?.throwIfAborted();
    onProgress(2, 2);
    return game.analysis;
  },
}));
const saveAnalysis = vi.hoisted(() => vi.fn(async (_gameId: string, _saved: unknown) => {}));
vi.mock('./storage', () => ({ saveAnalysis }));

const game = real1 as unknown as LichessGameJson;

test('a run analyses each game not analysed yet, in order, and saves it; pausing stops it, unsaved, until it carries on', async () => {
  const games = ['a', 'b', 'c'].map(id => ({ ...game, id }));
  const analyses = new AnalysisRun(games, { b: { analysis: [], engine: '', nodes: 0, at: '' } }, () => {}); // b is done
  run.onGame = id => id === 'a' && analyses.pause(); // pause during the first game
  await analyses.start();
  expect([analyses.running, saveAnalysis.mock.calls.length]).toEqual([false, 0]);
  expect(analyses.waiting().map(g => g.id)).toEqual(['a', 'c']); // the first game starts again from scratch

  run.onGame = () => {};
  await analyses.start();
  expect(saveAnalysis.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
  expect(Object.keys(analyses.saved).sort()).toEqual(['a', 'b', 'c']);
  expect(analyses.saved.a).toMatchObject({ analysis: game.analysis, engine: 'Stockfish 19', nodes: 1_000_000 });
  expect(analyses.waiting()).toEqual([]);
});

test("a game that can't be analysed is noted, with why, and the run goes on to the next", async () => {
  saveAnalysis.mockClear();
  const games = [{ ...game, id: 'empty', moves: '' }, { ...game, id: 'fine' }];
  const analyses = new AnalysisRun(games, {}, () => {});
  await analyses.start();
  expect(analyses.failed).toEqual({ empty: 'no moves' });
  expect(saveAnalysis.mock.calls.map(([id]) => id)).toEqual(['fine']);
  expect(analyses.waiting()).toEqual([]); // not tried again in this run's page
});
