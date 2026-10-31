// navigate.ts: stepping through the moves, for the buttons under the move list, the keyboard, and
// the scroll wheel. From lila's ui/analyse/src/navigate.ts (master, commit 27ffc8b).
// Every change from lila's version is marked with a comment starting "Trim:".

import type { AnalysisCtrl } from './analysisCtrl';
import type { TreeNode } from './tree';

// Trim: lila's treePath.init from ui/lib/src/tree/path.ts. A path without its last move.
const init = (path: string): string => path.slice(0, -2);

export default class Navigate {
  constructor(private readonly ctrl: AnalysisCtrl) {}

  // One move forward. When there are several continuations, the one chosen in the fork box.
  // While you're solving a mistake, it won't step onto the move that was played in the game.
  next = (): void => {
    if (this.ctrl.retro?.preventGoingToNextMove()) return;
    if (this.ctrl.fork.proceed()) return;
    const child = this.ctrl.node.children[0];
    if (child) this.ctrl.userJumpIfCan(this.ctrl.path + child.id);
  };

  prev = (): void => this.ctrl.userJumpIfCan(init(this.ctrl.path));

  // Not in lila: while hiding hints, the card's position is as far as you can go.
  last = (): void =>
    this.ctrl.userJumpIfCan(
      this.ctrl.hidingHints() ? this.ctrl.retro!.current()!.prev.path : this.ctrl.mainline.map(n => n.id).join(''),
    );

  first = (): void => this.ctrl.userJump('');

  // Back to the last move that has a variation.
  previousBranch = (): void => {
    let path = init(this.ctrl.path),
      parent = this.ctrl.tree.nodeAtPath(path);
    while (path.length && parent && this.ctrl.visibleChildren(parent).length < 2) {
      path = init(path);
      parent = this.ctrl.tree.nodeAtPath(path);
    }
    this.ctrl.userJumpIfCan(path);
  };

  // Forward to the next move that has a variation.
  nextBranch = (): void => {
    let child: TreeNode | undefined = this.ctrl.visibleChildren()[this.ctrl.fork.selectedIndex];
    let path = this.ctrl.path;
    while (child && child.children.length < 2) {
      path += child.id;
      child = child.children[0];
    }
    if (child) this.ctrl.userJumpIfCan(path + child.id);
    else if (this.ctrl.tree.pathIsMainline(this.ctrl.path)) this.last();
    else this.exitVariation();
  };

  private readonly exitVariation = (): void => {
    if (this.ctrl.onMainline) return;
    let found,
      path = '';
    this.ctrl.nodeList.slice(1, -1).forEach((n: TreeNode) => {
      path += n.id;
      if (n.children[1]) found = path;
    });
    if (found) this.ctrl.userJump(found);
  };
}
