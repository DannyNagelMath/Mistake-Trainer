// components.ts: moves written out as text, like "15...Qh4?", and the game's result. Copied from
// lila's ui/analyse/src/view/components.ts (renderResult, renderIndexAndMove, renderIndex,
// renderMoveNodes; master, commit 27ffc8b), with plyToTurn from ui/lib/src/game/chess.ts and
// renderEval from ui/lib/src/ceval/util.ts. Used by the retro panel and the move list.

import { h, type VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { hl } from './snabbdom';
import { status, statusOf } from './status';
import type { TreeNode } from './tree';
import type { EvalScore } from './winningChances';

type Glyph = NonNullable<TreeNode['glyphs']>[number];

// The move number that `ply` belongs to: plies 1 and 2 are move 1.
const plyToTurn = (ply: number): number => Math.floor((ply - 1) / 2) + 1;

// Centipawns as pawns, e.g. -153 as "-1.5". Step 8: exported for the eval chart.
export function renderEval(e: number): string {
  e = Math.max(Math.min(Math.round(e / 10) / 10, 99), -99);
  return (e > 0 ? '+' : '') + e.toFixed(1);
}
const normalizeEval = renderEval; // lila imports renderEval under this name

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

// Step 6: the result and how the game ended, under the move list, e.g. "0-1" and
// "White resigned • Black is victorious".
// Trim: lila also shows a study chapter's result, and its Termination tag.
export function renderResult(ctrl: AnalysisCtrl): VNode[] {
  if (ctrl.hidingHints()) return []; // not in lila: it would say who won
  const render = (result: string, statusText: string) => [hl('div.result', result), hl('div.status', statusText)];
  const game = ctrl.game;
  if (game.status && status[game.status] >= status.mate) {
    const winner = game.winner;
    const result = winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : '½-½';
    const ply = ctrl.mainline[ctrl.mainline.length - 1].ply; // lila's game.turns
    return render(result, statusOf({ winner, status: game.status, ply }));
  }
  return [];
}
