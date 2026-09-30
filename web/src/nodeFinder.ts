// nodeFinder.ts: copied from lila's ui/analyse/src/nodeFinder.ts (only what retrospect and, since step 8,
// the advice summary need).

import type { TreeNode } from './tree';
import * as winningChances from './winningChances';

const hasCompChild = (node: TreeNode): boolean => node.children.some(c => !!c.comp);

// Step 8: the next move by `color` with the glyph `symbol` (e.g. '??'), after `fromPly` and
// going round to the start of the game again, for the advice summary.
export const nextGlyphSymbol = (
  color: 'white' | 'black',
  symbol: string,
  mainline: TreeNode[],
  fromPly: number,
): TreeNode | undefined =>
  mainline
    .map((_, i) => mainline[(fromPly - mainline[0].ply + i + 1) % mainline.length])
    .find(n => n.ply % 2 === (color === 'white' ? 1 : 0) && n.glyphs?.some(g => g.symbol === symbol));

export const evalSwings = (mainline: TreeNode[], nodeFilter: (node: TreeNode) => boolean): TreeNode[] =>
  mainline.slice(1).filter((curr, i) => {
    const prev = mainline[i];
    return (
      nodeFilter(curr) &&
      curr.eval &&
      prev.eval &&
      hasCompChild(prev) &&
      (Math.abs(winningChances.povDiff('white', prev.eval, curr.eval)) > 0.1 ||
        (prev.eval.mate && !curr.eval.mate && Math.abs(prev.eval.mate) <= 3))
    );
  });