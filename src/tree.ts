// tree.ts: Not in lila, whose server builds the tree (modules/tree TreeBuilder): lila's analysis
// tree, built in the browser from a game as Lichess's API exports it, with its computer analysis.

import { Chess, type Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { scalachessCharPair } from 'chessops/compat';

import type { SavedAnalysis } from './analyses';
import type { EngineEval } from './engine';

// ---------- Input: only the fields of the API's game JSON that we use ----------

const GLYPHS = {
  Inaccuracy: { id: 6, symbol: '?!', name: 'Inaccuracy' },
  Mistake: { id: 2, symbol: '?', name: 'Mistake' },
  Blunder: { id: 4, symbol: '??', name: 'Blunder' },
};

export interface LichessAnalysisEntry {
  eval?: number; // centipawns, from White's point of view
  mate?: number; // mate in N; positive means White mates
  best?: string; // UCI; present only on judged moves
  variation?: string; // space-separated SAN; present only on judged moves
  judgment?: { name: 'Inaccuracy' | 'Mistake' | 'Blunder'; comment: string };
}

export interface LichessGameJson {
  id: string;
  moves: string; // space-separated SAN
  initialFen?: string; // present only for games started from a custom position
  analysis?: LichessAnalysisEntry[]; // analysis[i] describes the position after moves[i]
  status?: string; // how the game ended, e.g. 'mate', 'resign', 'outoftime' (lila's StatusName)
  winner?: 'white' | 'black'; // absent for draws
  variant?: string; // e.g. 'standard' or 'chess960'
  players?: { white: LichessPlayer; black: LichessPlayer };
  // For the player strips and the side panel.
  clocks?: number[]; // clocks[i]: the clock of whoever played moves[i], just after it, in centiseconds
  clock?: { initial: number; increment: number }; // the time control, in seconds
  createdAt?: number; // milliseconds since 1970
  speed?: string; // e.g. 'blitz'
  rated?: boolean;
  // The plies where the middlegame and the endgame start, from lila's analysis. Either is
  // missing if the game never got there.
  division?: { middle?: number; end?: number };
  // Not in Lichess's export: for a game Lichess hasn't analysed, how and when the analysis in
  // `analysis` was made instead, on your computer (localAnalysis.ts). The deck adds it (deck.ts
  // withAnalysis).
  analysedHere?: Omit<SavedAnalysis, 'analysis'>;
}

// `user` is absent for the computer and anonymous players.
export interface LichessPlayer {
  user?: { id: string; name: string }; // id is the lowercase username
  rating?: number;
  ratingDiff?: number; // how much the game changed the rating
  provisional?: boolean; // a rating with few games behind it, shown with a "?"
  aiLevel?: number; // for Stockfish
  analysis?: { inaccuracy: number; mistake: number; blunder: number; acpl: number; accuracy?: number };
}

// ---------- Output: the subset of lila's TreeNode that retrospect and the move list read ----------

// lila's TreeComment has an id too, and `by` can be a study member.
export interface TreeComment {
  by: string;
  text: string;
}

export interface TreeNode {
  id: string; // 2 characters; '' for the root. A path is these ids joined together.
  ply: number;
  fen: string;
  uci?: string;
  san?: string;
  // The computer analysis of the position: Lichess's, or the one made on your computer (deck.ts
  // withAnalysis). best: on a judged move, the better move the analysis gives instead of it, from
  // the position before (LichessAnalysisEntry.best).
  eval?: { cp?: number; mate?: number; best?: string };
  // lila's ceval: Stockfish's evaluation of the position, in the browser, while it searches.
  // Only set on a move you try that retroCtrl has to check (see engine.ts).
  ceval?: EngineEval;
  comp?: boolean; // only the first node of an engine line is marked comp = true
  collapsed?: boolean; // its variations are folded away in the move list (variation hiding)
  // From lila: the main line from this move on is shown as a variation ("Convert to variation", in
  // the move list's menu), although it's still children[0]. Only one move at a time has it.
  forceVariation?: boolean;
  glyphs?: { id: number; symbol: string; name: string }[];
  comments?: TreeComment[]; // e.g. "Mistake. Nf3 was best." by 'lichess', on the judged move
  clock?: number; // the clock of whoever just moved, in centiseconds; at the root, the starting time
  children: TreeNode[]; // children[0] is always the mainline continuation
}

// ---------- Building ----------

export function buildTree(game: LichessGameJson): TreeNode {
  const pos = startPosition(game);
  const root: TreeNode = {
    id: '',
    // ply 0 for a normal game; games from a custom position start later
    ply: (pos.fullmoves - 1) * 2 + (pos.turn === 'white' ? 0 : 1),
    fen: makeFen(pos.toSetup()),
    clock: game.clock && game.clock.initial * 100, // like lila's, the starting time
    children: [],
  };

  const sans = game.moves.split(' ').filter(san => san !== '');
  let parent = root;
  for (let i = 0; i < sans.length; i++) {
    const before = pos.clone(); // kept in case an engine line starts from here
    const node = playSan(pos, sans[i], parent.ply + 1); // mutates pos

    node.clock = game.clocks?.[i];
    const entry = game.analysis?.[i];
    if (entry) node.eval = toEval(entry);
    if (entry?.judgment) node.glyphs = [GLYPHS[entry.judgment.name]];
    // lila's server adds the same text as a comment by 'lichess' (modules/tree TreeBuilder).
    if (entry?.judgment) node.comments = [{ by: 'lichess', text: entry.judgment.comment }];

    parent.children.push(node); // pushed first, so it's children[0]
    if (entry?.variation) parent.children.push(buildCompLine(before, entry.variation, node.ply));

    parent = node;
  }
  return root;
}

function startPosition(game: LichessGameJson): Chess {
  if (!game.initialFen) return Chess.default();
  return Chess.fromSetup(parseFen(game.initialFen).unwrap()).unwrap();
}

// Plays `san` on `pos` (mutating it) and returns a node for the resulting position.
function playSan(pos: Position, san: string, ply: number): TreeNode {
  const move = parseSan(pos, san);
  if (!move) throw new Error(`Could not parse "${san}" at ply ${ply} in ${makeFen(pos.toSetup())}`);
  const id = scalachessCharPair(move);
  // Note: castling comes out king-to-rook (e1h1), as chessops writes it. Lichess's data writes it
  // either way; the masters' moves, which retrospect compares with these, are written this way when
  // the deck is built (deck.ts withMasterMoves).
  const uci = makeUci(move);
  pos.play(move);
  return { id, ply, san, uci, fen: makeFen(pos.toSetup()), children: [] };
}

function toEval(entry: LichessAnalysisEntry): TreeNode['eval'] {
  const best = entry.best ? { best: entry.best } : {}; // for lila's best move arrows (autoShape.ts)
  if (entry.mate !== undefined) return { mate: entry.mate, ...best };
  if (entry.eval !== undefined) return { cp: entry.eval, ...best };
  return undefined;
}

// Builds the engine's suggested line as a chain of nodes.
// Only the first node of an engine line is marked comp = true.
// `before` is the position before the mistake; it is cloned, not mutated.
function buildCompLine(before: Position, variation: string, firstPly: number): TreeNode {
  const pos = before.clone();
  const sans = variation.split(' ');
  const first = playSan(pos, sans[0], firstPly);
  first.comp = true;
  let parent = first;
  for (let j = 1; j < sans.length; j++) {
    const node = playSan(pos, sans[j], firstPly + j);
    parent.children.push(node);
    parent = node;
  }
  return first;
}

// ---------- Reading ----------

// The root followed by each mainline node, in order (lila's mainline includes the root).
export function mainline(root: TreeNode): TreeNode[] {
  const nodes = [root];
  let node = root;
  while (node.children[0]) {
    node = node.children[0];
    nodes.push(node);
  }
  return nodes;
}

export function mainlinePlyToPath(line: TreeNode[], ply: number): string {
  return line
    .filter(n => n.ply <= ply)
    .map(n => n.id)
    .join(''); // the root's id is '', so it contributes nothing
}

export function nodeAtPath(root: TreeNode, path: string): TreeNode {
  let node = root;
  for (let i = 0; i < path.length; i += 2) {
    const id = path.slice(i, i + 2);
    const child = node.children.find(c => c.id === id);
    if (!child) throw new Error(`No node at path "${path}" (failed at step ${i / 2 + 1})`);
    node = child;
  }
  return node;
}

// ---------- Helpers from lila's ui/lib/src/tree/ops.ts, for the move list ----------

// True if there's a variation within maxDepth moves of `node`, or the line is longer than that.
export const hasBranching = (node: TreeNode, maxDepth: number): boolean =>
  maxDepth <= 0 || !!node.children[1] || (!!node.children[0] && hasBranching(node.children[0], maxDepth - 1));

// True if `descendant` is `container` or somewhere in the moves after it.
export function contains(container: TreeNode, descendant: TreeNode): boolean {
  return container === descendant || !!container.children?.some(child => contains(child, descendant));
}

// How many moves there are from `node` on, itself included, and how many comments they have: for
// "Delete from here" in the move list's menu, which asks first when it's a lot.
export function countChildrenAndComments(node: TreeNode): { nodes: number; comments: number } {
  const count = {
    nodes: 1,
    comments: (node.comments || []).length,
  };
  node.children.forEach(function (child) {
    const c = countChildrenAndComments(child);
    count.nodes += c.nodes;
    count.comments += c.comments;
  });
  return count;
}

// How many moves apart two paths are, going back to where they split and forward again.
export function distance(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i] && a[i + 1] === b[i + 1]) i += 2;
  return (a.length + b.length) / 2 - i;
}
