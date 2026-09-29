// components.ts: moves written out as text, like "15...Qh4?". Copied from lila's
// ui/analyse/src/view/components.ts (renderIndexAndMove, renderIndex, renderMoveNodes; master,
// commit 27ffc8b), with plyToTurn from ui/lib/src/game/chess.ts and renderEval from
// ui/lib/src/ceval/util.ts. The retro panel uses these now, and the move list will in step 6.

import { h, type VNode } from 'snabbdom';

import type { TreeNode } from './tree';
import type { EvalScore } from './winningChances';

type Glyph = NonNullable<TreeNode['glyphs']>[number];

// The move number that `ply` belongs to: plies 1 and 2 are move 1.
const plyToTurn = (ply: number): number => Math.floor((ply - 1) / 2) + 1;

// Centipawns as pawns, e.g. -153 as "-1.5". lila imports renderEval under this name.
function normalizeEval(e: number): string {
  e = Math.max(Math.min(Math.round(e / 10) / 10, 99), -99);
  return (e > 0 ? '+' : '') + e.toFixed(1);
}

export const renderIndexAndMove = (node: TreeNode, withEval: boolean, withGlyphs: boolean): VNode[] =>
  node.san ? [renderIndex(node.ply, true), ...renderMoveNodes(node, withEval, withGlyphs)] : [];

export const renderIndex = (ply: number, withDots: boolean): VNode =>
  h('index', plyToTurn(ply) + (withDots ? (ply % 2 === 1 ? '.' : '...') : ''));

export function renderMoveNodes(
  node: TreeNode,
  withEval: boolean,
  withGlyphs: boolean,
  ev?: EvalScore | false,
  glyphs?: Glyph[],
): VNode[] {
  ev ??= node.eval; // ev = false will override withEval. Trim: lila prefers node.ceval, the local engine's eval.
  const evalText = !ev
    ? ''
    : ev?.cp !== undefined
      ? normalizeEval(ev.cp)
      : ev?.mate !== undefined
        ? `#${ev.mate}`
        : '';
  // Trim: lila's titles also say where the eval came from ("Cloud eval · 1,234 nodes searched").
  const attrs = !withEval && ev ? { title: evalText } : undefined;
  const nodes = [h('san', { attrs }, node.san!)]; // Trim: lila fixes crazyhouse drops here (fixCrazySan).
  const relevantGlyphs = glyphs ?? node.glyphs;
  if (withGlyphs && relevantGlyphs)
    relevantGlyphs.forEach(g => nodes.push(h('glyph', { attrs: { title: g.name } }, g.symbol)));
  // Trim: lila marks moves that have arrows or circles drawn on them (node.shapes) here.
  if (withEval && evalText && ev) nodes.push(h('eval', evalText.replace('-', '−')));
  return nodes;
}
