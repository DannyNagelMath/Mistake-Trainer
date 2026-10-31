// localAnalysis.ts: Not in lila. Lichess's computer analysis of a game, made on your computer, for
// games Lichess hasn't analysed. It comes out in the form of the analysis in Lichess's game export
// (LichessAnalysisEntry in tree.ts), so the deck and the board use it as they use Lichess's.
//
// Lichess's analysis is made in two places, and this does what both do:
//   - fishnet, the program volunteers run to analyse games for Lichess, searches each position
//     with Stockfish (fishnet.ts);
//   - lila turns what fishnet found into evaluations, judgments such as "Mistake. Nb5 was best.",
//     and engine lines (modules/fishnet/src/main/AnalysisBuilder.scala and UciToSan.scala,
//     modules/tree/src/main/Info.scala, Analysis.scala, and Advice.scala, and
//     modules/analyse/src/main/JsonView.scala; master, commit 27ffc8b).
// Every change from theirs is marked with a comment starting "Trim:".

import { Chess, type Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci, parseUci } from 'chessops/util';

import type { EngineEval } from './engine';
import { searchGame } from './fishnet';
import type { LichessAnalysisEntry, LichessGameJson } from './tree';

// ---------- Searching each position (fishnet.ts) ----------

// What Stockfish found in a position: its evaluation, from White's side, and its line, in UCI as
// chessops writes it (castling as the king taking its own rook, e1h1, as fishnet has Stockfish
// write it), and in SAN. A position where the game is over isn't searched: as fishnet does, it gets
// mate 0 if it's checkmate, otherwise 0, and no line.
export interface Evaluation {
  cp?: number;
  mate?: number;
  pv: string[];
  sans: string[];
}

// The longest line lila keeps (Info.LineMaxPlies, used by fishnet's JsonApi cappedPv).
const LINE_MAX_PLIES = 12;

// Analyses a game: fishnet.ts searches its positions, as fishnet does, and the rest is lila's.
// onProgress says how many positions are done, of how many. Aborting `signal` stops it, with an
// error.
export async function analyseGame(
  game: LichessGameJson,
  onProgress: (done: number, total: number) => void = () => {},
  signal?: AbortSignal,
): Promise<LichessAnalysisEntry[]> {
  const pos = game.initialFen ? Chess.fromSetup(parseFen(game.initialFen).unwrap()).unwrap() : Chess.default();
  const rootFen = makeFen(pos.toSetup());
  const startPly = (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 0 : 1); // as in tree.ts
  const positions: Position[] = [pos.clone()];
  const played: string[] = []; // the game's moves, in chessops' UCI
  for (const san of game.moves.split(' ').filter(san => san !== '')) {
    const move = parseSan(pos, san);
    if (!move) throw new Error(`Could not parse "${san}" in ${makeFen(pos.toSetup())}`);
    played.push(makeUci(move));
    pos.play(move);
    positions.push(pos.clone());
  }

  const outcomes = positions.map(p => p.outcome());
  const found = await searchGame(rootFen, played, outcomes.map(o => !!o), onProgress, signal);
  const evals = positions.map((p, i): Evaluation => {
    const outcome = outcomes[i];
    if (outcome) return { ...(outcome.winner ? { mate: 0 } : { cp: 0 }), pv: [], sans: [] };
    return fromEngine(p, found[i]!);
  });
  return toEntries(makeInfos(evals, played, startPly));
}

// Stockfish's answer, with its line cut to LINE_MAX_PLIES and written in SAN too. If a move in the
// line can't be played (it shouldn't happen), there's no line, as lila leaves out a line it can't
// write in SAN (UciToSan).
function fromEngine(position: Position, e: EngineEval): Evaluation {
  const evaluation = { cp: e.cp, mate: e.mate };
  const pos = position.clone();
  const pv: string[] = [];
  const sans: string[] = [];
  for (const uci of (e.pv ?? []).slice(0, LINE_MAX_PLIES)) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return { ...evaluation, pv: [], sans: [] };
    pv.push(makeUci(move));
    sans.push(makeSanAndPlay(pos, move));
  }
  return { ...evaluation, pv, sans };
}

// ---------- Evaluations (lila's AnalysisBuilder.makeInfos) ----------

// lila's Info, for a move: the evaluation after it (from White's side), and Stockfish's line from
// the position before it, if that starts with another move than the one played. ply is the ply
// after the move: 1 for White's first move.
export interface Info {
  ply: number;
  cp?: number;
  mate?: number;
  variation: string[]; // UCI; its first move is the better one
  sans: string[]; // the same moves, in SAN
}

// evals has one Evaluation for each position from the start, one more than there are moves. A
// checkmate at the end is left out, as in lila, so the move that gave it has no Info.
export function makeInfos(evals: Evaluation[], moves: string[], startPly: number): Info[] {
  const kept = evals.filter(e => e.mate !== 0);
  return moves.slice(0, kept.length - 1).map((move, i) => {
    const [before, after] = [kept[i], kept[i + 1]];
    const differs = before.pv.length > 0 && before.pv[0] !== move;
    return {
      ply: startPly + i + 1,
      cp: after.cp,
      mate: after.mate,
      variation: differs ? before.pv : [],
      sans: differs ? before.sans : [],
    };
  });
}

// ---------- Judgments (lila's Advice.scala) ----------

type Score = Pick<Info, 'cp' | 'mate'>;
export type Judgment = NonNullable<LichessAnalysisEntry['judgment']>;

// lila's Info.start: the evaluation before the first move is taken to be +0.15 (evals.initial),
// whatever Stockfish says of the starting position.
const START: Score = { cp: 15 };

// Winning chances, from -1 to 1, as lila's server works them out (scalachess's
// WinPercent.winningChances). Unlike the board's (winningChances.ts, from lila's client), they
// don't cap the evaluation at ±10 pawns first.
const winningChances = (cp: number): number => 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;

// lila's Advice: the judgment of the move that led to `info`, given the score before it, or
// undefined if the move is fine. A drop in winning chances (CpAdvice) of at least 0.1 is an
// inaccuracy, 0.2 a mistake, and 0.3 a blunder; mates have their own rules (MateAdvice).
export function judge(prev: Score, info: Info): Judgment | undefined {
  const whiteMoved = info.ply % 2 === 1;
  if (prev.cp !== undefined && info.cp !== undefined) {
    const drop = (winningChances(info.cp) - winningChances(prev.cp)) * (whiteMoved ? -1 : 1);
    const name = drop >= 0.3 ? 'Blunder' : drop >= 0.2 ? 'Mistake' : drop >= 0.1 ? 'Inaccuracy' : undefined;
    return name && { name, comment: comment(name, info) };
  }
  return mateAdvice(prev, info, whiteMoved);
}

// lila's MateAdvice, for a move that walks into a forced mate ("Checkmate is now unavoidable"), or
// gives up one you had ("Lost forced checkmate sequence"). The scores are from the side of the
// player who moved, so a positive mate is theirs. How bad it is depends on how good things were
// before walking into the mate, or are still after giving it up.
function mateAdvice(prev: Score, info: Info, whiteMoved: boolean): Judgment | undefined {
  const sign = whiteMoved ? 1 : -1;
  const pov = (s: Score): Score => ({
    cp: s.cp === undefined ? undefined : s.cp * sign,
    mate: s.mate === undefined ? undefined : s.mate * sign,
  });
  const [before, after] = [pov(prev), pov(info)];
  if (before.cp !== undefined && after.mate !== undefined && after.mate < 0) {
    const cp = before.cp;
    return mateJudgment(cp < -999 ? 'Inaccuracy' : cp < -700 ? 'Mistake' : 'Blunder', 'Checkmate is now unavoidable', info);
  }
  if (before.mate !== undefined && before.mate > 0 && (after.cp !== undefined || (after.mate ?? 0) < 0)) {
    const cp = after.cp ?? 0;
    return mateJudgment(cp > 999 ? 'Inaccuracy' : cp > 700 ? 'Mistake' : 'Blunder', 'Lost forced checkmate sequence', info);
  }
  return undefined;
}

const mateJudgment = (name: Judgment['name'], description: string, info: Info): Judgment => ({
  name,
  comment: comment(description, info),
});

// lila's Advice.makeComment, as the export writes it (no evaluations): e.g. "Mistake. Nb5 was best."
const comment = (description: string, info: Info): string =>
  `${description}.` + (info.sans[0] ? ` ${info.sans[0]} was best.` : '');

// ---------- The export (lila's UciToSan and JsonView.moves) ----------

// The analysis as Lichess's game export gives it: for each move, the evaluation after it, and for a
// judged move, the better move (best, in UCI), Stockfish's line (variation, in SAN), and the
// judgment. As lila keeps them (UciToSan), moves that aren't judged have no line. A move is only
// judged if Stockfish preferred another one (Analysis.infoAdvices).
export function toEntries(infos: Info[]): LichessAnalysisEntry[] {
  return infos.map((info, i) => {
    const judgment = info.variation.length > 0 ? judge(i > 0 ? infos[i - 1] : START, info) : undefined;
    return {
      ...(info.cp !== undefined ? { eval: info.cp } : {}),
      ...(info.mate !== undefined ? { mate: info.mate } : {}),
      ...(judgment ? { best: info.variation[0], variation: info.sans.join(' '), judgment } : {}),
    };
  });
}
