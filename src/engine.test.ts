// engine.test.ts: checks how engine.ts reads Stockfish's answers, and that it says when it's
// searching. (Stockfish itself needs a browser, so a stand-in answers for it here, and the tests
// elsewhere use a stand-in for engine.ts.)
import { afterEach, expect, test, vi } from 'vitest';

import { parseInfo } from './engine';

const line = 'info depth 14 seldepth 20 multipv 1 score cp 35 nodes 812345 nps 450000 time 1805 pv e2e4 e7e5';

test('an info line gives the score from White’s side, how far the search got, and the line', () => {
  const pv = ['e2e4', 'e7e5'];
  expect(parseInfo(line, true)).toEqual({ cp: 35, depth: 14, nodes: 812345, millis: 1805, pv });
  expect(parseInfo(line, false)).toEqual({ cp: -35, depth: 14, nodes: 812345, millis: 1805, pv }); // Black to move
  expect(parseInfo(line.replace('cp 35', 'mate -3'), false)).toMatchObject({ mate: 3 }); // Black is mated: White mates
});

test('lines that are not exact scores are skipped, as lila does', () => {
  expect(parseInfo(line.replace('cp 35', 'cp 35 lowerbound'), true)).toBeUndefined();
  expect(parseInfo(line.replace('cp 35', 'cp 35 upperbound'), true)).toBeUndefined();
  expect(parseInfo('info depth 1 score mate 0 nodes 1 time 0', true)).toBeUndefined(); // already checkmate
  expect(parseInfo('info depth 1 score cp 20', true)).toBeUndefined(); // no positions searched or time
  expect(parseInfo('info string NNUE evaluation using nn-61e7af4bb97d.nnue', true)).toBeUndefined();
  expect(parseInfo('bestmove e2e4 ponder e7e5', true)).toBeUndefined();
  expect(parseInfo('uciok', true)).toBeUndefined();
});

// A stand-in for Stockfish's Web Worker: it answers "uci" and "isready" as Stockfish does, and
// each search at once with the same evaluation.
class FakeStockfish {
  onmessage: (e: { data: string }) => void = () => {};
  onerror: (e: unknown) => void = () => {};
  postMessage(line: string) {
    if (line === 'uci') this.say('uciok');
    if (line === 'isready') this.say('readyok');
    if (line.startsWith('go ')) {
      this.say('info depth 18 score cp 30 nodes 1000000 time 900 pv e2e4');
      this.say('bestmove e2e4');
    }
  }
  say(line: string) {
    setTimeout(() => this.onmessage({ data: line }));
  }
}
afterEach(() => vi.unstubAllGlobals());

test('it says when it starts searching, and when it has nothing left to search (not in between)', async () => {
  vi.resetModules();
  vi.stubGlobal('Worker', FakeStockfish);
  const engine = await import('./engine');
  const said: boolean[] = [];
  engine.onSearching(searching => said.push(searching));
  const first = engine.evaluate('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  const second = engine.evaluate('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'); // waits its turn
  expect(said).toEqual([true]);
  await first;
  expect(said).toEqual([true]); // on to the second check
  await second;
  expect(said).toEqual([true, false]);
});
