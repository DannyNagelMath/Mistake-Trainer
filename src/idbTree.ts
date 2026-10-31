// idbTree.ts: which variations are folded away in the move list ("Enable variation hiding", lila's
// disclosure mode), remembered for each game. From lila's ui/analyse/src/idbTree.ts (27ffc8b).
// Trim: only the folding; lila's also saves the moves you add and the engine's evals, and has
// stepLine (shift+up/down).

import type { AnalysisCtrl } from './analysisCtrl';
import { hasBranching, type TreeNode } from './tree';

// 'expanded' means a node's variations or comments break up the move list, and 'collapsed' that
// you folded them away with its button, which only shows with variation hiding on.
export type DiscloseState = undefined | 'expanded' | 'collapsed';

// Trim: lila keeps the folded paths in IndexedDB (its 'analyse-collapse' store, one entry per
// game). Here they're in localStorage, under one key: { [game id]: paths }. It can be read at
// once, so the move list never shows before the folds are known (lila hides it until they are).
const STORAGE_KEY = 'analyse.collapse';

function storedPaths(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') ?? {};
  } catch {
    return {}; // no storage (the tests), or not ours
  }
}

export class IdbTree {
  constructor(private readonly ctrl: AnalysisCtrl) {}

  // With collapsed true, whether some of the variations from `path` on are folded away, and with
  // false, whether some aren't: the move list's menu then offers "Expand all", or "Collapse all".
  // Only with variation hiding on.
  someCollapsedOf(collapsed: boolean, path = ''): boolean {
    return (
      this.ctrl.settings.disclosureMode &&
      this.ctrl.tree.walkUntilTrue(
        (n, m) => this.isCollapsible(n, m) && collapsed === Boolean(n.collapsed),
        path,
        path !== '',
      )
    );
  }

  setCollapsed(path: string, collapsed: boolean): void {
    this.ctrl.tree.updateAt(path, n => (n.collapsed = collapsed));
    this.saveCollapsed();
    this.ctrl.redraw();
  }

  // Folds away (or brings back) every variation from `from` on: "Collapse all" and "Expand all".
  setCollapsedFrom(from: string, collapsed: boolean, thisBranchOnly = false): void {
    this.ctrl.tree.walkUntilTrue(
      (n, m) => {
        if (this.isCollapsible(n, m)) n.collapsed = collapsed;
        return false;
      },
      from,
      thisBranchOnly,
    );
    this.saveCollapsed();
    this.ctrl.redraw();
  }

  // Unfold the variations on the way to the position shown, so that its move is never folded
  // away. Trim: lila's can also take another path than the current one.
  revealNode(): void {
    let save = false;
    const nodes = this.ctrl.nodeList;
    for (let i = 0; i < nodes.length; i++) {
      const kid = nodes[i].children[0];
      if (nodes[i].collapsed && kid && nodes[i + 1] && kid !== nodes[i + 1]) {
        nodes[i].collapsed = false;
        save = true;
      }
    }
    if (save) this.saveCollapsed();
  }

  discloseOf(node: TreeNode | undefined, isMainline: boolean): DiscloseState {
    if (!node) return undefined;
    return this.isCollapsible(node, isMainline)
      ? this.ctrl.settings.disclosureMode && node.collapsed
        ? 'collapsed'
        : 'expanded'
      : undefined;
  }

  // The first time a game is shown, lila folds the deeper variations (collapseDefault); after
  // that, the variations you folded. Trim: lila's is async, and also loads the moves and evals.
  load(): void {
    const collapsedPaths = storedPaths()[this.id];
    if (!Array.isArray(collapsedPaths)) this.collapseDefault();
    else
      for (const path of collapsedPaths) {
        this.ctrl.tree.updateAt(path, n => (n.collapsed = true));
      }
  }

  // Trim: lila's id is a study chapter's when there is one.
  private get id(): string {
    return this.ctrl.game.id;
  }

  private saveCollapsed(): void {
    try {
      const all = storedPaths();
      all[this.id] = this.getCollapsed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {}
  }

  private isCollapsible(node: TreeNode, isMainline: boolean): boolean {
    const [first, second, third] = node.children.filter(n => this.ctrl.settings.showStaticAnalysis || !n.comp);
    return Boolean(
      first?.forceVariation ||
        third ||
        (second && hasBranching(second, 6)) ||
        (isMainline && this.ctrl.treeView.mode === 'column' && (second || first?.comments?.filter(Boolean).length)),
    );
  }

  private getCollapsed(): string[] {
    const collapsedPaths: string[] = [];
    function traverse(node: TreeNode, path: string): void {
      if (node.collapsed) collapsedPaths.push(path);
      for (const c of node.children) traverse(c, path + c.id);
    }
    traverse(this.ctrl.tree.root, '');
    return collapsedPaths;
  }

  private collapseDefault() {
    const depthThreshold = 1;

    const traverse = (node: TreeNode, depth: number) => {
      if (depth === depthThreshold && this.isCollapsible(node, false)) {
        node.collapsed = true;
      }
      node.children.forEach((n, i) => traverse(n, depth + (i === 0 ? 0 : 1)));
    };
    traverse(this.ctrl.tree.root, 0);
  }
}
