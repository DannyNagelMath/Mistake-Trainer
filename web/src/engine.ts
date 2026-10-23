// engine.ts: Not in lila. Stockfish, running in the browser, for "Learn from your mistakes": when
// you play a move that is neither the engine's best nor a master move, retroCtrl asks how good it
// is (lila's checkCeval). lila's analysis board has a whole engine module for that and more
// (ui/lib/src/ceval); this does only what the check needs: evaluate one position at a time,
// reporting as the search goes deeper, as lila's engine does.
//
// The engine is stockfish.js (the npm package `stockfish`, GPL-3.0): Stockfish 19 compiled to
// WebAssembly. Its "lite, single-threaded" build is small (about 2 MB) and needs nothing special
// from the page; vite.config.ts serves it at /stockfish/. It runs in a Web Worker, so the page
// doesn't freeze while it thinks, and speaks UCI, the chess engine protocol: we send it lines of
// text like "go nodes 1000000", and it answers with lines like "info depth 12 ... score cp 35".

// An evaluation, from White's side like all of lila's: cp in centipawns, or mate in moves
// (negative when Black mates). depth, nodes, and millis say how far the search got.
export interface EngineEval {
  cp?: number;
  mate?: number;
  depth: number;
  nodes: number; // positions searched
  millis: number; // time searched
  bestmove?: string; // once the search is over
}

const ENGINE = '/stockfish/stockfish-19-lite-single.js';
// lila judges your move once its engine has searched 1,000,000 positions or for 3 seconds
// (retroCtrl's isCevalReady), so the search stops there.
const GO = 'go nodes 1000000 movetime 3000';

let worker: Worker | undefined;
let started: Promise<void> | undefined;
let listener: (line: string) => void = () => {};
let queue: Promise<unknown> = Promise.resolve();
const finished = new Map<string, EngineEval>(); // by FEN, so a position is only searched once

// Evaluates the position, calling onInfo each time the search gets deeper, and resolves with the
// final evaluation. One position at a time: a second call waits for the first to finish.
export function evaluate(fen: string, onInfo: (e: EngineEval) => void = () => {}): Promise<EngineEval> {
  const done = finished.get(fen);
  if (done) return Promise.resolve(done);
  const search = queue.then(() => run(fen, onInfo));
  queue = search.catch(() => {});
  return search;
}

// Starts the engine, the first time it's needed. "uci" asks it to introduce itself; "uciok"
// means it's ready for commands.
function start(): Promise<void> {
  worker = new Worker(ENGINE);
  worker.onmessage = e => listener(String(e.data));
  return new Promise((resolve, reject) => {
    worker!.onerror = e => reject(new Error(e.message || `couldn't load ${ENGINE}`));
    listener = line => line === 'uciok' && resolve();
    worker!.postMessage('uci');
  });
}

async function run(fen: string, onInfo: (e: EngineEval) => void): Promise<EngineEval> {
  await (started ??= start());
  const whiteToMove = fen.split(' ')[1] === 'w';
  let last: EngineEval = { depth: 0, nodes: 0, millis: 0 };
  return new Promise(resolve => {
    listener = line => {
      const info = parseInfo(line, whiteToMove);
      if (info) onInfo((last = info));
      else if (line.startsWith('bestmove ')) {
        const result = { ...last, bestmove: line.split(' ')[1] };
        finished.set(fen, result);
        resolve(result);
      }
    };
    worker!.postMessage(`position fen ${fen}`);
    worker!.postMessage(GO);
  });
}

// One of Stockfish's "info" lines with a score, as an EngineEval; undefined for any other line.
// Stockfish gives scores from the side to move, so they're turned round when Black is to move.
// Like lila's engine protocol (ui/lib/src/ceval/protocol.ts), it skips lines without the
// positions searched and the time, scores that are only bounds ("lowerbound", "upperbound"),
// and "mate 0", which Stockfish sends for a position that is already checkmate.
export function parseInfo(line: string, whiteToMove: boolean): EngineEval | undefined {
  const words = line.split(' ');
  const at = words.indexOf('score');
  if (words[0] !== 'info' || at < 0 || !words.includes('nodes') || !words.includes('time')) return;
  if (words.includes('lowerbound') || words.includes('upperbound')) return;
  const number = (key: string) => (words.includes(key) ? Number(words[words.indexOf(key) + 1]) : 0);
  const score = Number(words[at + 2]) * (whiteToMove ? 1 : -1);
  if (words[at + 1] === 'mate' && score === 0) return;
  return {
    ...(words[at + 1] === 'mate' ? { mate: score } : { cp: score }),
    depth: number('depth'),
    nodes: number('nodes'),
    millis: number('time'),
  };
}
