// pgnExport.ts: moves written out as PGN, for "Copy main line PGN" and "Copy variation PGN" in the
// move list's menu (contextMenu.ts). From lila's ui/analyse/src/pgnExport.ts (renderPgnTags and
// renderNodesPgn; master, commit 27ffc8b), with plyPrefix and renderNodesTxt from
// ui/lib/src/game/nodePGN.ts.
// Every change from lila's version is marked with a comment starting "Trim:".
// Trim: lila removes the P from crazyhouse pawn drops (fixCrazySan) wherever it writes a move.

import { INITIAL_FEN } from 'chessops/fen';

import { plyToTurn } from './components';
import type { LichessGameJson, TreeNode } from './tree';

// The PGN tags that come before the moves: only for a game that didn't start from the usual
// position. Trim: lila also writes a Variant tag for the other variants, which the deck doesn't have.
function renderPgnTags(game: LichessGameJson): string {
  let txt = '';
  const tags: Array<[string, string]> = [];
  if (game.initialFen && game.initialFen !== INITIAL_FEN) tags.push(['FEN', game.initialFen]);
  if (tags.length) txt = tags.map(t => '[' + t[0] + ' "' + t[1] + '"]').join('\n') + '\n\n';
  return txt;
}

// Trim: lila also has renderFullTxt and renderNodesHtml, for other parts of its page.

// The moves in nodeList (the root, then each move up to one move), then the moves after that one:
// the line it's on, and with includeSubVariations, the variations along the way, in brackets.
export function renderNodesPgn(game: LichessGameJson, nodeList: TreeNode[], includeSubVariations: boolean): string {
  const nonRootNodes = nodeList.filter(node => node.san);
  let pgn = '';

  if (nonRootNodes.length) {
    const first = nonRootNodes[0];
    pgn += `${plyPrefix(first)}${first.san} `;

    for (let i = 1; i < nonRootNodes.length; i++) {
      const node = nonRootNodes[i];
      if (node.ply % 2 === 1) {
        pgn += plyToTurn(node.ply) + '. ';
      }

      pgn += node.san! + ' ';
    }
  }

  pgn += renderNodesTxt(nodeList[nodeList.length - 1], nonRootNodes.length === 0, includeSubVariations);

  return pgn ? renderPgnTags(game) + pgn : '';
}

// ---------- ui/lib/src/game/nodePGN.ts ----------

// The move number to write before a move: "12. " before White's, "12... " before Black's.
const plyPrefix = (node: TreeNode): string => `${Math.floor((node.ply + 1) / 2)}${node.ply % 2 === 1 ? '. ' : '... '}`;

// The moves after `node`, e.g. "12... Nxe4 (12... d5 13. exd5) 13. Qe2": the line, and with
// includeVariations, the variations along the way, in brackets. forcePly: write the first move's
// number even if it's Black's.
function renderNodesTxt(node: TreeNode, forcePly: boolean, includeVariations = true): string {
  const first = node.children[0];
  // Without the variations, it stops at a move made into a variation ("Convert to variation").
  if (!first || (!includeVariations && first.forceVariation)) return '';

  let s = '';
  if (forcePly || first.ply % 2 === 1) s += plyPrefix(first);
  s += first.san!;

  if (includeVariations) {
    for (let i = 1; i < node.children.length; i++) {
      const child = node.children[i];
      s += ` (${plyPrefix(child)}${child.san!}`;
      const variation = renderNodesTxt(child, false, includeVariations);
      if (variation) s += ' ' + variation;
      s += ')';
    }
  }

  const mainline = renderNodesTxt(first, s.endsWith(')'), includeVariations);
  if (mainline) s += ' ' + mainline;

  return s;
}
