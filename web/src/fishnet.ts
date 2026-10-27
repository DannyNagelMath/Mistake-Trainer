// fishnet.ts: Not in lila. What fishnet, the program volunteers run to analyse games for Lichess,
// does on their computers, for localAnalysis.ts (github.com/lichess-org/fishnet, master:
// src/queue.rs, src/stockfish.rs, and src/main.rs). It splits a game's positions into batches of
// five, and several Stockfish engines search them side by side, a batch at a time, each engine on
// one thread.
//
// So a game's analysis comes out the same every time, whichever engine searches which batch, and
// however many engines there are: each batch starts with an empty memory ("ucinewgame"), and
// Stockfish on one thread always searches a position the same way from the same memory. (On
// several threads, how the threads happen to keep pace with each other changes what a search finds.)
//
// The engines are stockfish.js's one-thread build (the npm package `stockfish`, GPL-3.0): Stockfish
// 19 compiled to WebAssembly, with its full network, the version and network fishnet has used since
// 5 September 2026. vite.config.ts serves it at /stockfish/. Each engine runs in a Web Worker of
// its own, apart from engine.ts's engine, which checks your moves and analyses live.
// Every change from fishnet's is marked with a comment starting "Trim:".

import { parseInfo, type EngineEval } from './engine';

export const ENGINE_NAME = 'Stockfish 19';
const ENGINE = '/stockfish/stockfish-19-single.js';
// Lichess's servers search each position of a game you ask them to analyse for 1,000,000 positions
// (lila's fishnet Work.Origin.manualRequest).
export const GAME_NODES = 1_000_000;

// How many engines search side by side: one for each core but one, at least one, as fishnet does
// unless told otherwise (main.rs, and configure.rs's Cores::Auto).
// Trim: here there are at most four, as each engine holds its own copy of Stockfish and its network,
// over 300 MB in all.
export const engineCount = (): number => Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));

// ---------- Batches (queue.rs) ----------

// A batch of a game's positions. Positions are numbered from the game's start: 0 is the position
// before the first move. warmUp is searched first, to fill the engine's memory a little, and its
// evaluation isn't kept.
export interface Batch {
  warmUp: number;
  positions: number[];
}

// fishnet's batches of a game's `count` positions: from the last position to the first, so that
// what an engine works out in later positions helps it in earlier ones, five to a batch
// (Chunk::MAX_POSITIONS, less the warm-up). A batch's warm-up is the position just after its first,
// the last one searched in the batch before. The first batch's is its own first position, the
// game's last, which is so searched twice, "to offset that it is analyzed with completely fresh
// hash".
// Trim: lila tells fishnet to leave out the first positions of a game it already has a deeper
// evaluation of, from its cloud evaluations (skipPositions, from lila's FishnetEvalCache), and uses
// that evaluation instead. Here every position is searched.
export function batchesOf(count: number): Batch[] {
  const batches: Batch[] = [];
  for (let first = count - 1; first >= 0; first -= 5)
    batches.push({
      warmUp: Math.min(first + 1, count - 1),
      positions: Array.from({ length: Math.min(5, first + 1) }, (_, i) => first - i),
    });
  return batches;
}

// ---------- Searching a game ----------

// A game's positions to search: the position it started from, its moves in UCI, and which positions
// are game over (checkmate, stalemate, or too little material left to mate), which aren't searched.
interface Game {
  rootFen: string;
  moves: string[];
  over: boolean[];
}

// A batch of a game, waiting for an engine or being searched.
interface Job {
  game: Game;
  batch: Batch;
  signal: AbortSignal; // aborted if the game's search ends early
  found: (index: number, e: EngineEval | undefined) => void; // as each position of the batch is done
  done: () => void;
  fail: (e: unknown) => void;
}

interface Engine {
  worker: Worker;
  ready: Promise<void>; // the engine has loaded
  listener: (line: string) => void; // for each line Stockfish sends
  broke: (e: Error) => void; // fails whatever is waiting on the engine, if it breaks
  job?: Job; // the batch it's searching
}

const engines: Engine[] = [];
const waiting: Job[] = []; // batches waiting for an engine, oldest first

// Searches each position of a game, as fishnet does, and resolves with what Stockfish found in each,
// numbered from 0 for the position before the first move: its final evaluation, from White's side,
// and its line. Positions where the game is over are left undefined. moves are in UCI with castling
// written as the king taking its own rook (e1h1), as chessops writes it, and as fishnet has
// Stockfish write it (see startEngine). onProgress says how many positions are done, of how many.
// Aborting `signal` stops the engines searching the game, and rejects with its reason.
export function searchGame(
  rootFen: string,
  moves: string[],
  over: boolean[],
  onProgress: (done: number, total: number) => void = () => {},
  signal?: AbortSignal,
): Promise<(EngineEval | undefined)[]> {
  const game: Game = { rootFen, moves, over };
  const total = moves.length + 1;
  const results: (EngineEval | undefined)[] = Array(total).fill(undefined);
  const stopped = new AbortController(); // aborted if the search ends early: by `signal`, or a failure
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const batches = batchesOf(total);
    let done = 0;
    let left = batches.length;
    const jobs: Job[] = batches.map(batch => ({
      game,
      batch,
      signal: stopped.signal,
      found: (index, e) => {
        results[index] = e;
        onProgress(++done, total);
      },
      done: () => {
        if (--left === 0) finish();
      },
      fail: e => finish(e),
    }));
    const onAbort = () => finish(signal!.reason);
    // The end of the search, with an error if it ends early: the game's batches that are waiting
    // are dropped, and the engines searching the others stop ("stop", which makes Stockfish answer
    // at once).
    function finish(error?: unknown) {
      if (stopped.signal.aborted) return;
      signal?.removeEventListener('abort', onAbort);
      if (error === undefined) return resolve(results);
      stopped.abort(error);
      for (const job of jobs) if (waiting.includes(job)) waiting.splice(waiting.indexOf(job), 1);
      for (const engine of engines) if (engine.job && jobs.includes(engine.job)) engine.worker.postMessage('stop');
      reject(error);
    }
    signal?.addEventListener('abort', onAbort);
    waiting.push(...jobs);
    next();
  });
}

// Ends the engines, to give back their memory, once a run of games is over or paused. The next
// search starts new ones. A batch still being searched (of a game that was stopped) is let go.
export function stopEngines(): void {
  for (const engine of engines.splice(0)) {
    engine.worker.terminate();
    engine.broke(new Error('The engines were stopped'));
  }
}

// Gives each free engine the next waiting batch, starting the engines the first time (and one in
// place of any that broke).
function next(): void {
  if (waiting.length) while (engines.length < engineCount()) engines.push(startEngine());
  for (const engine of engines) {
    if (engine.job) continue;
    const job = waiting.shift();
    if (!job) return;
    run(engine, job);
  }
}

async function run(engine: Engine, job: Job): Promise<void> {
  engine.job = job;
  try {
    await engine.ready;
    await searchBatch(engine, job);
    job.done();
  } catch (e) {
    job.fail(e);
  }
  engine.job = undefined;
  next();
}

// ---------- One engine (stockfish.rs) ----------

// Starts an engine as fishnet's init does: it's told to write castling the Chess960 way, as the
// king taking its own rook (e1h1), as chessops does; then "isready", which it answers with
// "readyok" once it has loaded.
function startEngine(): Engine {
  const worker = new Worker(ENGINE);
  const engine: Engine = { worker, ready: Promise.resolve(), listener: () => {}, broke: () => {} };
  engine.ready = new Promise((resolve, reject) => {
    engine.broke = reject;
    engine.listener = line => {
      if (line === 'readyok') resolve();
    };
  });
  engine.ready.catch(() => {}); // if it fails to load, the batch given to it says so (run)
  worker.onmessage = e => engine.listener(String(e.data));
  // If it can't load, or breaks later, it's dropped, and its batch fails, which ends that game's
  // search.
  worker.onerror = e => {
    if (!engines.includes(engine)) return;
    engines.splice(engines.indexOf(engine), 1);
    worker.terminate();
    const error = new Error(e.message || `couldn't run ${ENGINE}`);
    engine.broke(error);
    engine.job?.fail(error);
  };
  worker.postMessage('setoption name UCI_Chess960 value true');
  worker.postMessage('isready');
  return engine;
}

// Searches a batch as fishnet's go_multiple does: from an empty memory, and with fishnet's options
// for analysis, which are also Stockfish's own defaults (fishnet sets them for each batch, as its
// engines also play games, at lower levels); then the positions, the warm-up first.
async function searchBatch(engine: Engine, { game, batch, signal, found }: Job): Promise<void> {
  signal.throwIfAborted();
  engine.worker.postMessage('ucinewgame');
  engine.worker.postMessage('setoption name MultiPV value 1');
  engine.worker.postMessage('setoption name Skill Level value 20');
  for (const [i, index] of [batch.warmUp, ...batch.positions].entries()) {
    const warmUp = i === 0;
    if (game.over[index]) {
      if (!warmUp) found(index, undefined); // fishnet gives it the game's result, without the engine
      continue;
    }
    const e = await search(engine, game, index);
    signal.throwIfAborted();
    if (!warmUp) found(index, e);
  }
}

// Searches a position as fishnet's go does: given as the game's start and its moves up to there,
// so that Stockfish knows which positions came before (a repetition is a draw); 1,000,000
// positions; and the deepest score that isn't only a bound, with its line (parseInfo skips the
// rest, as fishnet does).
function search(engine: Engine, { rootFen, moves }: Game, index: number): Promise<EngineEval> {
  const whiteToMove = (rootFen.split(' ')[1] === 'w') === (index % 2 === 0);
  return new Promise((resolve, reject) => {
    engine.broke = reject;
    let last: EngineEval | undefined;
    engine.listener = line => {
      const info = parseInfo(line, whiteToMove);
      if (info) last = info;
      else if (line.startsWith('bestmove ')) {
        if (last) resolve({ ...last, bestmove: line.split(' ')[1] });
        else reject(new Error('Stockfish gave no evaluation')); // fishnet: "missing score"
      }
    };
    engine.worker.postMessage(`position fen ${rootFen} moves ${moves.slice(0, index).join(' ')}`);
    engine.worker.postMessage(`go nodes ${GAME_NODES}`);
  });
}
