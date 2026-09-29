// treeView.ts: renders the move list and handles clicks on it. From lila's
// ui/analyse/src/treeView/treeView.ts (master, commit 27ffc8b).
// Every change from lila's version is marked with a comment starting "Trim:".

import type { Hooks, VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderColumnView } from './columnView';
import { renderInlineView } from './inlineView';
import { onInsert } from './snabbdom';

export class TreeView {
  constructor(readonly ctrl: AnalysisCtrl) {}
  private autoScrollRequest: ScrollBehavior | false = false;

  mode: 'column' | 'inline' = 'column'; // Trim: lila leaves this unset until the first render.

  // Trim: lila's `hidden` getter hides the list until IndexedDB has loaded.

  render(): VNode {
    // Trim: lila always uses the column view for broadcasts (concealOf).
    this.mode = !this.ctrl.settings.inline ? 'column' : 'inline';
    return this.mode === 'column' ? renderColumnView(this.ctrl) : renderInlineView(this.ctrl);
  }

  // Asks for the list to scroll to the current move after the next redraw.
  requestAutoScroll(request: ScrollBehavior | false) {
    this.autoScrollRequest = request;
  }

  // snabbdom hooks for the list's scrolling element, div.analyse__moves.
  hook(): Hooks {
    const { ctrl } = this;
    return {
      ...onInsert(el => {
        if (ctrl.path !== '') this.autoScrollRequest = 'instant';
        // Trim: lila opens a context menu on right-click (or double-click or long press on touch
        // screens), to delete or promote variations, copy them, and so on.
        el.addEventListener('pointerup', (e: PointerEvent) => {
          if (!(e.target instanceof HTMLElement)) return;
          if (e.target.classList.contains('disclosure') || (e.button !== undefined && e.button !== 0)) return;
          const path = eventPath(e);
          if (path) ctrl.userJump(path);
          this.autoScrollRequest = false; // you clicked the move, so it's already in view
          ctrl.redraw();
        });
      }),
      postpatch: () => {
        if (this.autoScrollRequest) {
          autoScroll(this.autoScrollRequest);
          this.autoScrollRequest = false;
        }
      },
    };
  }
}

// Each <move> has its path in a `p` attribute. A click can land on the move's children
// (<san>, <glyph>, ...), so this also checks the parent.
const eventPath = (e: MouseEvent): string | null => {
  const target = e.target as HTMLElement;
  return target.getAttribute('p') || target.parentElement!.getAttribute('p');
};

// Trim: lila's throttle is in ui/lib/src/async.ts, built on throttlePromise. This does the same:
// it runs f at once, then at most once per `delay` ms, always finishing with the latest call.
function throttle<T extends (...args: any[]) => void>(delay: number, f: T): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Parameters<T> | undefined;
  const run = (args: Parameters<T>) => {
    f(...args);
    timer = setTimeout(() => {
      timer = undefined;
      if (pending) {
        const next = pending;
        pending = undefined;
        run(next);
      }
    }, delay);
  };
  return (...args: Parameters<T>) => {
    if (timer) pending = args;
    else run(args);
  };
}

// Scrolls the move list so the active move is in the middle of what's visible.
const autoScroll = throttle(200, (behavior: ScrollBehavior = 'instant') => {
  const scrollView = document.querySelector<HTMLElement>('.analyse__moves')!;
  const moveEl = scrollView.querySelector<HTMLElement>('.active');
  if (!moveEl) return scrollView.scrollTo({ top: 0, behavior });
  const [move, view] = [moveEl.getBoundingClientRect(), scrollView.getBoundingClientRect()];
  const visibleHeight = Math.min(view.bottom, window.innerHeight) - Math.max(view.top, 0);
  scrollView.scrollTo({
    top: scrollView.scrollTop + move.top - view.top - (visibleHeight - move.height) / 2,
    behavior,
  });
});
