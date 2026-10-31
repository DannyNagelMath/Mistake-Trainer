// keyboard.ts: keyboard shortcuts for the analysis page. From lila's ui/analyse/src/keyboard.ts
// (master, commit 27ffc8b). Every change from lila's version is marked with a comment starting "Trim:".
//
//   left or k: previous move         right or j: next move
//   up, 0, or home: first move       down, $, or end: last move
//   up / down when there's a choice of continuations: change which one "next" follows
//   shift, tapped on its own: the same as down there
//   shift+left / shift+right (or shift+k / shift+j): previous / next variation
//   shift+c: show or hide comments   shift+i: inline or two-column move list
//   z: show or hide the computer analysis   a: show or hide the best move arrows
//   v: show or hide the variation arrows
//   l: switch the engine on or off
//   h: open or close the menu        f: flip the board

import type { AnalysisCtrl } from './analysisCtrl';
import Mousetrap from './mousetrap';

// Trim: lila binds these on its global site.mousetrap; this makes one for the page, and returns it.
export const bind = (ctrl: AnalysisCtrl): Mousetrap => {
  const kbd = new Mousetrap();
  addModifierKeyListeners(ctrl, kbd);
  kbd
    .bind(['left', 'k'], () => {
      ctrl.navigate.prev();
      ctrl.redraw();
    })
    .bind(['right', 'j'], () => {
      ctrl.navigate.next();
      ctrl.redraw();
    })
    .bind(['up', '0', 'home'], e => {
      if (e.key === 'ArrowUp' && ctrl.fork.select('prev')) ctrl.setAutoShapes();
      else ctrl.navigate.first();
      ctrl.redraw();
    })
    .bind(['down', '$', 'end'], e => {
      if (e.key === 'ArrowDown' && ctrl.fork.select('next')) ctrl.setAutoShapes();
      else ctrl.navigate.last();
      ctrl.redraw();
    })
    .bind('shift+c', () => {
      ctrl.showComments = !ctrl.showComments;
      ctrl.treeView.requestAutoScroll('smooth');
      ctrl.redraw();
    })
    .bind('shift+i', () => ctrl.settings.set('inline', !ctrl.settings.inline));
  // Trim: lila's space bar plays the engine's best move, or turns the engine on.

  kbd
    .bind('h', () => {
      ctrl.toggleActionMenu();
      ctrl.redraw();
    })
    .bind('f', ctrl.flip)
    .bind('z', () => ctrl.settings.set('showStaticAnalysis', !ctrl.settings.showStaticAnalysis))
    .bind('a', () => ctrl.settings.set('showBestMoveArrows', !ctrl.settings.showBestMoveArrows))
    .bind('v', () => ctrl.settings.set('showVariationArrows', !ctrl.settings.showVariationArrows))
    .bind('l', () => ctrl.cevalEnabled(!ctrl.cevalEnabled()));
  // Trim: lila also has b (board editor), ? (keyboard help), x (threat), and e (opening explorer).

  kbd
    .bind(['shift+left', 'shift+k'], () => {
      ctrl.navigate.previousBranch();
      ctrl.redraw();
    })
    .bind(['shift+right', 'shift+j'], () => {
      ctrl.navigate.nextBranch();
      ctrl.redraw();
    });
  // Trim: lila's shift+up / shift+down step between sibling variations, and shift+space plays the
  // opening explorer's first move.
  return kbd;
};

// A tap of shift on its own, with no other key or click while it's down, selects the next
// continuation, as the down key does (fork.ts); the variation arrows show which one.
// Trim: lila's also folds variations on a tap of ctrl, and skips shift while you type in the chat.
// Not in lila: nothing while kbd is paused (main.ts), as these listen on the page outside it.
function addModifierKeyListeners(ctrl: AnalysisCtrl, kbd: Mousetrap) {
  let modifierOnly = false;

  window.addEventListener('mousedown', () => (modifierOnly = false), { capture: true });

  document.addEventListener('keydown', e => {
    if (e.key === 'Shift') modifierOnly = !modifierOnly;
    else modifierOnly = false;
  });

  document.addEventListener('keyup', e => {
    if (!modifierOnly) return;
    modifierOnly = false;
    if (kbd.paused) return;

    if (e.key === 'Shift' && ctrl.fork.select('next')) ctrl.setAutoShapes();
    ctrl.redraw();
  });
}
