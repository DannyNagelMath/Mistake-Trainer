// engine.test.ts: checks how engine.ts reads Stockfish's answers. (Stockfish itself needs a browser,
// so the tests elsewhere use a stand-in.)
import { expect, test } from 'vitest';

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
