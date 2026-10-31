// material.ts: Step 8. The material each side is up, shown beside the board as small pieces and a
// score like "+3". From lila's ui/lib/src/game/material.ts (getMaterialDiff, getScore) and
// ui/lib/src/game/view/material.ts (renderMaterialDiffs), master, commit 27ffc8b.
// Every change from lila's version is marked with a comment starting "Trim:".

import { charToRole, opposite, type Color, type Role } from 'chessops';
import { h, type VNode } from 'snabbdom';

// For each color, how many more of each piece it has than the other color.
type MaterialDiffSide = Record<Role, number>;
interface MaterialDiff {
  white: MaterialDiffSide;
  black: MaterialDiffSide;
}

// Trim: lila's also accepts a chessops Board.
function getMaterialDiff(fen: string): MaterialDiff {
  const diff: MaterialDiff = {
    white: { king: 0, queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
    black: { king: 0, queen: 0, rook: 0, bishop: 0, knight: 0, pawn: 0 },
  };
  const fenLike = fen.split(' ')[0];
  for (let i = 0, part = 0; i < fenLike.length && part < 8; i++) {
    const ch = fenLike[i];
    const lower = ch.toLowerCase();
    const role = charToRole(ch);
    if (role) {
      const color = ch === lower ? 'black' : 'white';
      const them = diff[opposite(color)];
      if (them[role] > 0) them[role]--;
      else diff[color][role]++;
    } else if (ch === '[' || ch === ' ') break;
    else if (ch === '/') part++;
  }
  return diff;
}

// White's material advantage in pawns: queen 9, rook 5, bishop and knight 3, pawn 1.
function getScore(diff: MaterialDiff): number {
  return (
    (diff.white.queen - diff.black.queen) * 9 +
    (diff.white.rook - diff.black.rook) * 5 +
    (diff.white.bishop - diff.black.bishop) * 3 +
    (diff.white.knight - diff.black.knight) * 3 +
    (diff.white.pawn - diff.black.pawn)
  );
}

// Trim: lila also shows the checks given, in the Three-check variant.
function renderMaterialDiff(material: MaterialDiffSide, score: number, position: 'top' | 'bottom'): VNode {
  const children: VNode[] = [];
  let role: Role;
  for (role in material) {
    if (material[role] > 0) {
      const content: VNode[] = [];
      for (let i = 0; i < material[role]; i++) content.push(h('mpiece.' + role));
      children.push(h('div', content));
    }
  }
  if (score > 0) children.push(h('score', '+' + score));
  return h('div.material.material-' + position, children);
}

// [the top player's, the bottom player's]. Trim: lila also takes the "show captured pieces"
// setting (on by default), and the checks for Three-check.
export function renderMaterialDiffs(bottomColor: Color, fen: string): [VNode, VNode] {
  const material = getMaterialDiff(fen);
  const score = getScore(material) * (bottomColor === 'white' ? 1 : -1);
  const topColor = opposite(bottomColor);
  return [
    renderMaterialDiff(material[topColor], -score, 'top'),
    renderMaterialDiff(material[bottomColor], score, 'bottom'),
  ];
}
