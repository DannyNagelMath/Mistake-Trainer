// fishnet.test.ts: checks that fishnet.ts searches a game's positions as fishnet does: its batches,
// and what each engine is told. Stockfish needs a browser, so a stand-in answers for it.
import { INITIAL_FEN } from 'chessops/fen';
import { afterEach, expect, test, vi } from 'vitest';

import { batchesOf } from './fishnet';

test("fishnet's batches: from the last position to the first, five to a batch, each after a warm-up", () => {
  expect(batchesOf(12)).toEqual([
    { warmUp: 11, positions: [11, 10, 9, 8, 7] }, // the last position, searched twice
    { warmUp: 7, positions: [6, 5, 4, 3, 2] },
    { warmUp: 2, positions: [1, 0] },
  ]);
  expect(batchesOf(6)).toEqual([
    { warmUp: 5, positions: [5, 4, 3, 2, 1] },
    { warmUp: 1, positions: [0] },
  ]);
  expect(batchesOf(1)).toEqual([{ warmUp: 0, positions: [0] }]);
});

// A stand-in for Stockfish's Web Worker: it notes the lines it's sent, answers "isready" as
// Stockfish does, and answers each search with an evaluation that says which position it was: the
// number of moves to it, in centipawns, from the side to move. While a test holds the answers back,
// it only answers when told to stop, as Stockfish does.
class FakeStockfish {
  static all: FakeStockfish[] = [];
  static holding = false;
  sent: string[] = [];
  position = '';
  searching = false;
  terminated = false;
  onmessage: (e: { data: string }) => void = () => {};
  onerror: (e: { message: string }) => void = () => {};
  constructor() {
    FakeStockfish.all.push(this);
  }
  postMessage(line: string) {
    this.sent.push(line);
    if (line === 'isready') setTimeout(() => this.say('readyok'));
    if (line.startsWith('position ')) this.position = line;
    if (line.startsWith('go ')) {
      this.searching = true;
      if (!FakeStockfish.holding) setTimeout(() => this.answer());
    }
    if (line === 'stop' && this.searching) setTimeout(() => this.answer());
  }
  terminate() {
    this.terminated = true;
  }
  answer() {
    const moves = this.position.split(' moves ')[1].split(' ').filter(m => m !== '');
    this.searching = false;
    this.say(`info depth 20 score cp ${moves.length} nodes 1000000 time 900 pv e2e4 e7e5`);
    this.say('bestmove e2e4');
  }
  say(line: string) {
    this.onmessage({ data: line });
  }
}

// A fresh fishnet.ts, on a computer with `cores` cores, so with one engine fewer.
async function freshFishnet(cores: number) {
  vi.resetModules();
  vi.stubGlobal('Worker', FakeStockfish);
  vi.stubGlobal('navigator', { hardwareConcurrency: cores });
  FakeStockfish.all = [];
  FakeStockfish.holding = false;
  return import('./fishnet');
}
// Waits, a little at a time, until `engine` has been sent `line`.
async function untilSent(engine: () => FakeStockfish | undefined, line: string) {
  for (let i = 0; i < 400 && !engine()?.sent.includes(line); i++) await new Promise(r => setTimeout(r, 5));
}
afterEach(() => vi.unstubAllGlobals());

// The moves to a position, from how an engine was told it.
const movesIn = (line: string) => line.split(' moves ')[1].split(' ').filter(m => m !== '').length;

test('a game is searched as fishnet does: each batch by one engine, from an empty memory, after its warm-up', async () => {
  const fishnet = await freshFishnet(3); // two engines
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6']; // seven positions: two batches
  const progress: number[] = [];
  const found = await fishnet.searchGame(INITIAL_FEN, moves, Array(7).fill(false), done => progress.push(done));

  const start = ['setoption name UCI_Chess960 value true', 'isready'];
  const batch = ['ucinewgame', 'setoption name MultiPV value 1', 'setoption name Skill Level value 20'];
  const position = (n: number) => [`position fen ${INITIAL_FEN} moves ${moves.slice(0, n).join(' ')}`, 'go nodes 1000000'];
  expect(FakeStockfish.all.map(engine => engine.sent)).toEqual([
    [...start, ...batch, ...[6, 6, 5, 4, 3, 2].flatMap(position)], // the last position twice: first to warm up
    [...start, ...batch, ...[2, 1, 0].flatMap(position)],
  ]);
  // What Stockfish found, from White's side, by position, without the warm-ups'.
  expect(found.map(e => e?.cp)).toEqual([0, -1, 2, -3, 4, -5, 6]);
  expect(found[0]).toEqual({ cp: 0, depth: 20, nodes: 1000000, millis: 900, pv: ['e2e4', 'e7e5'], bestmove: 'e2e4' });
  expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test('a position where the game is over is not searched, even to warm up', async () => {
  const fishnet = await freshFishnet(3);
  const moves = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']; // eight positions, the last checkmate
  const progress: number[] = [];
  const found = await fishnet.searchGame(INITIAL_FEN, moves, [...Array(7).fill(false), true], done => progress.push(done));
  const searched = FakeStockfish.all.map(engine => engine.sent.filter(l => l.startsWith('position ')).map(movesIn));
  expect(searched).toEqual([
    [6, 5, 4, 3], // the batch of positions 7 to 3, with 7 as its warm-up
    [3, 2, 1, 0],
  ]);
  expect(found[7]).toBeUndefined();
  expect(progress).toHaveLength(8);
});

test("stopping a game stops its engine's search and drops its waiting batches; the engine goes on to the next game", async () => {
  const fishnet = await freshFishnet(2); // one engine
  FakeStockfish.holding = true;
  const abort = new AbortController();
  const moves = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d3']; // two batches
  const game = fishnet.searchGame(INITIAL_FEN, moves, Array(8).fill(false), undefined, abort.signal);
  const engine = () => FakeStockfish.all[0];
  await untilSent(engine, 'go nodes 1000000');
  abort.abort(new Error('paused'));
  await expect(game).rejects.toThrow('paused');
  expect(engine().sent.at(-1)).toBe('stop');

  FakeStockfish.holding = false;
  const next = await fishnet.searchGame(INITIAL_FEN, ['e2e4'], [false, false]);
  expect(next.map(e => e?.cp)).toEqual([0, -1]);
  // Of the stopped game, only its warm-up was searched, and none of its second batch.
  const searched = engine().sent.filter(l => l.startsWith('position ')).map(movesIn);
  expect(searched).toEqual([7, 1, 1, 0]);
});

test('stopping the engines ends them, to give back their memory; the next search starts new ones', async () => {
  const fishnet = await freshFishnet(3); // two engines
  await fishnet.searchGame(INITIAL_FEN, ['e2e4'], [false, false]);
  fishnet.stopEngines();
  expect(FakeStockfish.all.map(engine => engine.terminated)).toEqual([true, true]);

  const next = await fishnet.searchGame(INITIAL_FEN, ['e2e4'], [false, false]);
  expect(next.map(e => e?.cp)).toEqual([0, -1]);
  expect(FakeStockfish.all).toHaveLength(4);
});

test('an engine that breaks fails the game it was searching, and a new one takes its place', async () => {
  const fishnet = await freshFishnet(2);
  FakeStockfish.holding = true;
  const game = fishnet.searchGame(INITIAL_FEN, ['e2e4'], [false, false]);
  await untilSent(() => FakeStockfish.all[0], 'go nodes 1000000');
  FakeStockfish.all[0].onerror({ message: 'out of memory' });
  await expect(game).rejects.toThrow('out of memory');

  FakeStockfish.holding = false;
  const next = await fishnet.searchGame(INITIAL_FEN, ['e2e4'], [false, false]);
  expect(next.map(e => e?.cp)).toEqual([0, -1]);
  expect(FakeStockfish.all).toHaveLength(2);
});
