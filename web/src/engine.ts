// engine.ts: Not in lila. Stockfish, running in the browser, for three things:
//   - checking a move you try that is neither the engine's best nor a master move (evaluate, for
//     retroCtrl's checkCeval);
//   - live analysis of the position on the board, once a card is done and you've switched the
//     engine on (analyse, for the evaluation, the best move arrow, and the engine's line);
//   - analysing a game Lichess hasn't analysed, position by position (searchGamePosition, for
//     localAnalysis.ts).
// lila's analysis board has a whole engine module for the first two (ui/lib/src/ceval); this does
// what we need of it, reporting as each search goes deeper, as lila's does.
//
// The engine is stockfish.js (the npm package `stockfish`, GPL-3.0): Stockfish 19 compiled to
// WebAssembly, with its full network, on several threads, like the engine Lichess users usually
// run. vite.config.ts serves it at /stockfish/, and makes the pages "cross-origin isolated", as
// threads need. A page without that gets the small "lite" build, on one thread. The engine runs
// in a Web Worker, so the page doesn't freeze while it thinks, and speaks UCI, the chess engine
// protocol: we send it lines of text like "go nodes 1000000", and it answers with lines like
// "info depth 12 ... score cp 35".
//
// There's one engine, so one search at a time. Move checks come first, and wait their turn. Live
// analysis only ever needs the latest position: asking for another stops the one running ("stop",
// which makes Stockfish answer at once), and a move check stops it too. A game's positions come
// last: a move check or live analysis stops one that's running, and it's searched again after.

// An evaluation, from White's side like all of lila's: cp in centipawns, or mate in moves
// (negative when Black mates). depth, nodes, and millis say how far the search got; pv is the
// engine's line, in UCI, starting with its best move.
export interface EngineEval {
  cp?: number;
  mate?: number;
  depth: number;
  nodes: number; // positions searched
  millis: number; // time searched
  pv?: string[];
  bestmove?: string; // once the search has run its course; not if it was stopped early
}

// The full network on several threads, where the page allows threads; else the lite build.
export const MULTI_THREADED = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
export const ENGINE_NAME = MULTI_THREADED ? 'Stockfish 19' : 'Stockfish 19 lite';
const ENGINE = MULTI_THREADED ? '/stockfish/stockfish-19.js' : '/stockfish/stockfish-19-lite-single.js';
// One thread fewer than the computer has, so the page stays responsive while the engine thinks.
const THREADS = MULTI_THREADED ? Math.max(1, (navigator.hardwareConcurrency || 2) - 1) : 1;
// lila judges your move once its engine has searched 1,000,000 positions or for 3 seconds
// (retroCtrl's isCevalReady), so a move check stops there.
const CHECK = 'go nodes 1000000 movetime 3000';
// Live analysis searches for 8 seconds, lila's default (CevalCtrl's storedMovetime).
export const ANALYSIS_MILLIS = 8000;
const ANALYSE = `go movetime ${ANALYSIS_MILLIS}`;
// Lichess's servers search each position of a game you ask them to analyse for 1,000,000 positions
// (lila's fishnet Work.Origin.manualRequest).
const GAME = 'go nodes 1000000';

interface Search {
  position: string; // what follows "position" in UCI: "fen ...", and "moves ..." for a game's position
  whiteToMove: boolean; // in the position searched, to turn Stockfish's scores to White's side
  go: string;
  kind: 'check' | 'live' | 'game'; // a move check, live analysis, or a position of a game to analyse
  newGame?: boolean; // clear what Stockfish remembers from earlier searches first ("ucinewgame")
  onInfo: (e: EngineEval) => void;
  onDone: (e: EngineEval) => void;
}

let worker: Worker | undefined;
let started: Promise<void> | undefined;
let listener: (line: string) => void = () => {};
let running: Search | undefined;
let stopping = false; // "stop" was sent to the running search
const checks: Search[] = []; // waiting move checks, oldest first
let nextAnalysis: Search | undefined; // the latest analysis asked for, waiting
const gamePositions: Search[] = []; // positions of games to analyse, waiting, in order
const checked = new Map<string, EngineEval>(); // move checks by FEN, so a position is only checked once

const whiteToMove = (fen: string): boolean => fen.split(' ')[1] === 'w';

// Checks the position after a move you tried: reports as the search goes deeper, and resolves
// with the final evaluation.
export function evaluate(fen: string, onInfo: (e: EngineEval) => void = () => {}): Promise<EngineEval> {
  const done = checked.get(fen);
  if (done) return Promise.resolve(done);
  return new Promise((resolve, reject) => {
    checks.push({
      position: `fen ${fen}`,
      whiteToMove: whiteToMove(fen),
      go: CHECK,
      kind: 'check',
      onInfo,
      onDone: result => {
        checked.set(fen, result);
        resolve(result);
      },
    });
    if (running && running.kind !== 'check') stop();
    next().catch(reject);
  });
}

// Live analysis of the position, reported as the search goes deeper: onInfo for each step, and
// onDone at the end, with bestmove set if the search ran its course. Replaces any analysis asked
// for before.
export function analyse(fen: string, onInfo: (e: EngineEval) => void, onDone: (e: EngineEval) => void = onInfo): void {
  nextAnalysis = { position: `fen ${fen}`, whiteToMove: whiteToMove(fen), go: ANALYSE, kind: 'live', onInfo, onDone };
  if (running && running.kind !== 'check') stop();
  next().catch(e => console.error(e));
}

// Stops live analysis: the engine's switch was turned off, or a new card hides it.
export function stopAnalysis(): void {
  nextAnalysis = undefined;
  if (running?.kind === 'live') stop();
}

// Whether live analysis is searching right now.
export const isAnalysing = (): boolean => running?.kind === 'live' && !stopping;

// Searches a position of a game for localAnalysis.ts, as Lichess's servers do: given as the game's
// start and the moves since, so that Stockfish knows which positions have come up before (a
// repetition is a draw), as fishnet gives them. Resolves with the search's final evaluation and
// line. newGame first clears what Stockfish remembers from earlier searches.
export function searchGamePosition(rootFen: string, moves: string[], newGame: boolean): Promise<EngineEval> {
  return new Promise((resolve, reject) => {
    gamePositions.push({
      position: `fen ${rootFen}` + (moves.length ? ` moves ${moves.join(' ')}` : ''),
      whiteToMove: whiteToMove(rootFen) === (moves.length % 2 === 0),
      go: GAME,
      kind: 'game',
      newGame,
      onInfo: () => {},
      onDone: resolve,
    });
    next().catch(reject);
  });
}

function stop(): void {
  if (stopping) return;
  stopping = true;
  worker?.postMessage('stop');
}

// Starts the next search, if the engine is free: a waiting move check, or else the latest analysis,
// or else a game's position. A game's position that was stopped goes back to wait again.
async function next(): Promise<void> {
  if (running) return;
  const search = checks.shift() ?? nextAnalysis ?? gamePositions.shift();
  if (!search) return;
  if (search === nextAnalysis) nextAnalysis = undefined;
  running = search;
  stopping = false;
  try {
    await (started ??= start());
  } catch (e) {
    running = undefined;
    throw e;
  }
  if (stopping) {
    // Stopped while the engine was loading: on to whatever is next.
    running = undefined;
    stopping = false;
    if (search.kind === 'game') gamePositions.unshift(search);
    return next();
  }
  let last: EngineEval = { depth: 0, nodes: 0, millis: 0 };
  listener = line => {
    const info = parseInfo(line, search.whiteToMove);
    if (info) search.onInfo((last = info));
    else if (line.startsWith('bestmove ')) {
      const stopped = stopping;
      running = undefined;
      stopping = false;
      if (stopped && search.kind === 'game') gamePositions.unshift(search);
      else search.onDone(stopped ? last : { ...last, bestmove: line.split(' ')[1] });
      next().catch(e => console.error(e));
    }
  };
  if (search.newGame) worker!.postMessage('ucinewgame');
  worker!.postMessage(`position ${search.position}`);
  worker!.postMessage(search.go);
}

// Starts the engine, the first time it's needed. "uci" asks it to introduce itself; at "uciok",
// it's told how many threads to use, and "isready" waits for it to be ready ("readyok").
function start(): Promise<void> {
  worker = new Worker(ENGINE);
  worker.onmessage = e => listener(String(e.data));
  return new Promise((resolve, reject) => {
    worker!.onerror = e => reject(new Error(e.message || `couldn't load ${ENGINE}`));
    listener = line => {
      if (line === 'uciok') {
        if (THREADS > 1) worker!.postMessage(`setoption name Threads value ${THREADS}`);
        worker!.postMessage('isready');
      } else if (line === 'readyok') resolve();
    };
    worker!.postMessage('uci');
  });
}

// Loads the engine in the background, as the page opens (main.ts), so that the first check
// doesn't wait for the full engine to load, which takes a few seconds. If it fails, the first
// search reports it.
export function preload(): void {
  (started ??= start()).catch(e => console.error(e));
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
  const pv = words.indexOf('pv');
  return {
    ...(words[at + 1] === 'mate' ? { mate: score } : { cp: score }),
    depth: number('depth'),
    nodes: number('nodes'),
    millis: number('time'),
    ...(pv >= 0 ? { pv: words.slice(pv + 1) } : {}),
  };
}
