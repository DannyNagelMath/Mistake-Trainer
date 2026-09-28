// nodeFinder.ts: copied from lila's ui/analyse/src/nodeFinder.ts (only what retrospect needs).

import type { TreeNode } from './tree';
import * as winningChances from './winningChances';

const hasCompChild = (node: TreeNode): boolean => node.children.some(c => !!c.comp);

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