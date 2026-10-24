// engine.ts: Not in lila. Stockfish, running in the browser, for two things:
//   - checking a move you try that is neither the engine's best nor a master move (evaluate, for
//     retroCtrl's checkCeval);
//   - live analysis of the position on the board, once a card is done and you've switched the
//     engine on (analyse, for the evaluation, the best move arrow, and the engine's line).
// lila's analysis board has a whole engine module for this (ui/lib/src/ceval); this does what we
// need of it, reporting as each search goes deeper, as lila's does.
//
// The engine is stockfish.js (the npm package `stockfish`, GPL-3.0): Stockfish 19 compiled to
// WebAssembly. Its "lite, single-threaded" build is small (about 2 MB) and needs nothing special
// from the page; vite.config.ts serves it at /stockfish/. It runs in a Web Worker, so the page
// doesn't freeze while it thinks, and speaks UCI, the chess engine protocol: we send it lines of
// text like "go nodes 1000000", and it answers with lines like "info depth 12 ... score cp 35".
//
// There's one engine, so one search at a time. Move checks come first, and wait their turn. Live
// analysis only ever needs the latest position: asking for another stops the one running ("stop",
// which makes Stockfish answer at once), and a move check stops it too.

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

export const ENGINE_NAME = 'Stockfish 19 lite';
const ENGINE = '/stockfish/stockfish-19-lite-single.js';
// lila judges your move once its engine has searched 1,000,000 positions or for 3 seconds
// (retroCtrl's isCevalReady), so a move check stops there.
const CHECK = 'go nodes 1000000 movetime 3000';
// Live analysis searches for 8 seconds, lila's default (CevalCtrl's storedMovetime).
export const ANALYSIS_MILLIS = 8000;
const ANALYSE = `go movetime ${ANALYSIS_MILLIS}`;

interface Search {
  fen: string;
  go: string;
  check: boolean; // a move check, rather than live analysis
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
const checked = new Map<string, EngineEval>(); // move checks by FEN, so a position is only checked once

// Checks the position after a move you tried: reports as the search goes deeper, and resolves
// with the final evaluation.
export function evaluate(fen: string, onInfo: (e: EngineEval) => void = () => {}): Promise<EngineEval> {
  const done = checked.get(fen);
  if (done) return Promise.resolve(done);
  return new Promise((resolve, reject) => {
    checks.push({
      fen,
      go: CHECK,
      check: true,
      onInfo,
      onDone: result => {
        checked.set(fen, result);
        resolve(result);
      },
    });
    if (running && !running.check) stop();
    next().catch(reject);
  });
}

// Live analysis of the position, reported as the search goes deeper: onInfo for each step, and
// onDone at the end, with bestmove set if the search ran its course. Replaces any analysis asked
// for before.
export function analyse(fen: string, onInfo: (e: EngineEval) => void, onDone: (e: EngineEval) => void = onInfo): void {
  nextAnalysis = { fen, go: ANALYSE, check: false, onInfo, onDone };
  if (running && !running.check) stop();
  next().catch(e => console.error(e));
}

// Stops live analysis: the engine's switch was turned off, or a new card hides it.
export function stopAnalysis(): void {
  nextAnalysis = undefined;
  if (running && !running.check) stop();
}

// Whether live analysis is searching right now.
export const isAnalysing = (): boolean => !!running && !running.check && !stopping;

function stop(): void {
  if (stopping) return;
  stopping = true;
  worker?.postMessage('stop');
}

// Starts the next search, if the engine is free: a waiting move check, or else the latest analysis.
async function next(): Promise<void> {
  if (running) return;
  const search = checks.shift() ?? nextAnalysis;
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
    // Analysis replaced or stopped while the engine was loading: on to whatever is next.
    running = undefined;
    stopping = false;
    return next();
  }
  const whiteToMove = search.fen.split(' ')[1] === 'w';
  let last: EngineEval = { depth: 0, nodes: 0, millis: 0 };
  listener = line => {
    const info = parseInfo(line, whiteToMove);
    if (info) search.onInfo((last = info));
    else if (line.startsWith('bestmove ')) {
      const result = stopping ? last : { ...last, bestmove: line.split(' ')[1] };
      running = undefined;
      stopping = false;
      search.onDone(result);
      next().catch(e => console.error(e));
    }
  };
  worker!.postMessage(`position fen ${search.fen}`);
  worker!.postMessage(search.go);
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
