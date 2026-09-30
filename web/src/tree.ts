// tree.ts: build a lila-style analysis tree from one game exported by the Lichess API as JSON
// (e.g. GET /game/export/{id} with Accept: application/json and evals=true).

import { Chess, type Position } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { scalachessCharPair } from 'chessops/compat';

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
  status?: string; // Step 6: how the game ended, e.g. 'mate', 'resign', 'outoftime' (lila's StatusName)
  winner?: 'white' | 'black'; // Step 6: absent for draws
  variant?: string; // Step 9: e.g. 'standard' or 'chess960'
  players?: { white: LichessPlayer; black: LichessPlayer }; // Step 9
}

// Step 9: `user` is absent for the computer and anonymous players.
export interface LichessPlayer {
  user?: { id: string; name: string }; // id is the lowercase username
  rating?: number;
}

// ---------- Output: the subset of lila's TreeNode that retrospect and the move list read ----------

// Step 6: lila's TreeComment has an id too, and `by` can be a study member.
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
  eval?: { cp?: number; mate?: number };
  comp?: boolean; // only the first node of an engine line is marked comp = true
  glyphs?: { id: number; symbol: string; name: string }[];
  comments?: TreeComment[]; // Step 6: e.g. "Mistake. Nf3 was best." by 'lichess', on the judged move
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
    children: [],
  };

  const sans = game.moves.split(' ').filter(san => san !== '');
  let parent = root;
  for (let i = 0; i < sans.length; i++) {
    const before = pos.clone(); // kept in case an engine line starts from here
    const node = playSan(pos, sans[i], parent.ply + 1); // mutates pos

    const entry = game.analysis?.[i];
    if (entry) node.eval = toEval(entry);
    if (entry?.judgment) node.glyphs = [GLYPHS[entry.judgment.name]];
    // Step 6: lila's server adds the same text as a comment by 'lichess' (modules/tree TreeBuilder).
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
  // Note: castling comes out king-to-rook (e1h1), where Lichess's own data says e1g1.
  // Retrospect only compares UCIs with the opening explorer, which we've stubbed out.
  const uci = makeUci(move);
  pos.play(move);
  return { id, ply, san, uci, fen: makeFen(pos.toSetup()), children: [] };
}

function toEval(entry: LichessAnalysisEntry): TreeNode['eval'] {
  if (entry.mate !== undefined) return { mate: entry.mate };
  if (entry.eval !== undefined) return { cp: entry.eval };
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

// ---------- Reading: what the adapter will expose as root.mainline, etc. ----------

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
// ---------- Step 6: helpers from lila's ui/lib/src/tree/ops.ts, for the move list ----------

// True if there's a variation within maxDepth moves of `node`, or the line is longer than that.
export const hasBranching = (node: TreeNode, maxDepth: number): boolean =>
  maxDepth <= 0 || !!node.children[1] || (!!node.children[0] && hasBranching(node.children[0], maxDepth - 1));

// True if `descendant` is `container` or somewhere in the moves after it.
export function contains(container: TreeNode, descendant: TreeNode): boolean {
  return container === descendant || !!container.children?.some(child => contains(child, descendant));
}

// How many moves apart two paths are, going back to where they split and forward again.
export function distance(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i] && a[i + 1] === b[i + 1]) i += 2;
  return (a.length + b.length) / 2 - i;
}
