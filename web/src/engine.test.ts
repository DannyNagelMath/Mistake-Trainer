// engine.test.ts: checks how engine.ts reads Stockfish's answers, and the order it searches in.
// (Stockfish itself needs a browser, so the order is checked with a stand-in for it, and the tests
// elsewhere use a stand-in for engine.ts.)
import { INITIAL_FEN } from 'chessops/fen';
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

// A stand-in for Stockfish's Web Worker: it notes the lines it's sent, answers "uci" and "isready"
// as Stockfish does, and says whatever a test tells it to.
class FakeStockfish {
  static last: FakeStockfish;
  sent: string[] = [];
  onmessage: (e: { data: string }) => void = () => {};
  onerror: (e: unknown) => void = () => {};
  constructor() {
    FakeStockfish.last = this;
  }
  postMessage(line: string) {
    this.sent.push(line);
    if (line === 'uci') setTimeout(() => this.say('uciok'));
    if (line === 'isready') setTimeout(() => this.say('readyok'));
  }
  say(line: string) {
    this.onmessage({ data: line });
  }
}

// A fresh engine.ts, which starts the stand-in, and a wait while it answers.
async function freshEngine() {
  vi.resetModules();
  vi.stubGlobal('Worker', FakeStockfish);
  return import('./engine');
}
const answers = () => new Promise(resolve => setTimeout(resolve, 10));
afterEach(() => vi.unstubAllGlobals());

test("a game's position is searched as Lichess's servers do: the game's moves, 1,000,000 positions", async () => {
  const engine = await freshEngine();
  const result = engine.searchGamePosition(INITIAL_FEN, ['e2e4'], true);
  await answers();
  const stockfish = FakeStockfish.last;
  // First, clear what it remembers from earlier searches: a new game.
  expect(stockfish.sent.slice(-3)).toEqual(['ucinewgame', `position fen ${INITIAL_FEN} moves e2e4`, 'go nodes 1000000']);
  stockfish.say('info depth 20 score cp 30 nodes 1000000 time 900 pv e7e5 g1f3'); // Black to move
  stockfish.say('bestmove e7e5');
  expect(await result).toEqual({ cp: -30, depth: 20, nodes: 1000000, millis: 900, pv: ['e7e5', 'g1f3'], bestmove: 'e7e5' });
});

test("a move check, or live analysis, stops a game's position, which is searched again in full after", async () => {
  const engine = await freshEngine();
  const position = engine.searchGamePosition(INITIAL_FEN, [], false);
  await answers();
  const stockfish = FakeStockfish.last;
  engine.stopAnalysis(); // switching live analysis off leaves it alone
  expect(stockfish.sent.at(-1)).toBe('go nodes 1000000');
  expect(engine.isAnalysing()).toBe(false); // it isn't live analysis

  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
  const check = engine.evaluate(fen);
  expect(stockfish.sent.at(-1)).toBe('stop');
  stockfish.say('info depth 8 score cp 25 nodes 20000 time 30 pv e2e4');
  stockfish.say('bestmove e2e4'); // its answer when stopped, which doesn't count
  await answers();
  expect(stockfish.sent.slice(-2)).toEqual([`position fen ${fen}`, 'go nodes 1000000 movetime 3000']);
  stockfish.say('info depth 18 score cp 40 nodes 1000000 time 800 pv g1f3');
  stockfish.say('bestmove g1f3');
  expect(await check).toMatchObject({ cp: 40, bestmove: 'g1f3' });

  await answers();
  expect(stockfish.sent.slice(-2)).toEqual([`position fen ${INITIAL_FEN}`, 'go nodes 1000000']); // again
  engine.analyse(fen, () => {}); // live analysis stops it too
  expect(stockfish.sent.at(-1)).toBe('stop');
  stockfish.say('bestmove e2e4');
  await answers();
  expect(stockfish.sent.slice(-2)).toEqual([`position fen ${fen}`, 'go movetime 8000']);
  stockfish.say('info depth 30 score cp 35 nodes 9000000 time 8000 pv g1f3');
  stockfish.say('bestmove g1f3');
  await answers();
  expect(stockfish.sent.slice(-2)).toEqual([`position fen ${INITIAL_FEN}`, 'go nodes 1000000']); // and again
  stockfish.say('info depth 21 score cp 20 nodes 1000000 time 900 pv e2e4 e7e5');
  stockfish.say('bestmove e2e4');
  expect(await position).toMatchObject({ cp: 20, depth: 21, pv: ['e2e4', 'e7e5'], bestmove: 'e2e4' });
});
