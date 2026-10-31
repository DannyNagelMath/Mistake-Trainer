// fork.ts: when the position on the board has more than one continuation (say the game move and
// the engine's line), a box under the move list offers each of them. Press "next" to follow the
// selected one; the up and down keys change the selection. From lila's ui/analyse/src/fork.ts
// (master, commit 27ffc8b). Every change from lila's version is marked with a comment starting "Trim:".

import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { addPointerListeners, isTouchDevice } from './common';
import { renderIndexAndMove } from './components';
import { hl, onInsert } from './snabbdom';
import type { TreeNode } from './tree';

export class ForkCtrl {
  selectedIndex = 0;

  private hoveringIndex?: number;
  private mostRecent?: TreeNode;

  constructor(private readonly ctrl: AnalysisCtrl) {}

  get forks(): TreeNode[] {
    return this.ctrl.visibleChildren();
  }

  get isVisible(): boolean {
    return this.forks.length > 1;
  }

  get selected(): TreeNode | undefined {
    return this.forks[this.hoveringIndex ?? this.selectedIndex];
  }

  // Resets the selection to the first continuation when the board has moved to another node.
  update() {
    if (this.mostRecent && this.mostRecent.id === this.ctrl.node.id) return;
    this.mostRecent = this.ctrl.node;
    this.selectedIndex = 0;
    this.hoveringIndex = undefined;
  }

  select(which: 'next' | 'prev') {
    if (!this.isVisible) return false;
    const numKids = this.forks.length;
    this.selectedIndex = (numKids + this.selectedIndex + (which === 'next' ? 1 : -1)) % numKids;
    return true;
  }

  // Trim: lila's hover() and highlight() draw an arrow for the continuation under the mouse.
  // They go through the opening explorer, which we don't have.

  proceed(it?: number) {
    if (this.isVisible) {
      it = it ?? this.hoveringIndex ?? this.selectedIndex;

      const childNode = this.forks[it];
      if (childNode !== undefined) {
        this.ctrl.userJumpIfCan(this.ctrl.path + childNode.id);
        return true;
      }
    }
    return undefined;
  }
}

// Each <move> in the box has its index in a data-it attribute. A click can land on the move's
// children (<index>, <san>, ...), so this also checks the parent.
const eventToIndex = (e: MouseEvent): number | undefined => {
  const target = e.target as HTMLElement;
  return parseInt(
    (target.parentNode as HTMLElement).getAttribute('data-it') || target.getAttribute('data-it') || '',
  );
};

// Trim: lila also takes `concealOf`, which hides moves a broadcast hasn't revealed yet.
export function view(ctrl: AnalysisCtrl): VNode | undefined {
  if (ctrl.retro?.isSolving()) return undefined; // Trim: lila also hides it in some studies.
  ctrl.fork.update();
  if (!ctrl.fork.isVisible) return undefined;
  return hl(
    'div.analyse__fork',
    {
      hook: onInsert(el => {
        addPointerListeners(el, {
          click: e => {
            ctrl.fork.proceed(eventToIndex(e));
            ctrl.redraw();
          },
        });
        // Trim: lila draws an arrow for the move under the mouse here (mouseover and mouseout).
      }),
    },
    ctrl.visibleChildren().map((node, it) =>
      hl(
        'move',
        {
          // Trim: lila also marks the correct and wrong moves in an interactive lesson (gamebook).
          class: { selected: it === ctrl.fork.selectedIndex && !isTouchDevice() },
          attrs: { 'data-it': it },
        },
        renderIndexAndMove(node, ctrl.settings.showStaticAnalysis, ctrl.settings.showStaticAnalysis),
      ),
    ),
  );
}
