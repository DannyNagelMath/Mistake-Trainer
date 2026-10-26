// keyboard.ts: keyboard shortcuts for the analysis page. From lila's ui/analyse/src/keyboard.ts
// (master, commit 27ffc8b). Every change from lila's version is marked with a comment starting "Trim:".
//
//   left or k: previous move         right or j: next move
//   up, 0, or home: first move       down, $, or end: last move
//   up / down when there's a choice of continuations: change which one "next" follows
//   shift+left / shift+right (or shift+k / shift+j): previous / next variation
//   shift+c: show or hide comments   shift+i: inline or two-column move list
//   z: show or hide Lichess's analysis   a: show or hide the best move arrows
//   l: switch the engine on or off
//   h: open or close the menu        f: flip the board

import type { AnalysisCtrl } from './analysisCtrl';
import Mousetrap from './mousetrap';

// Trim: lila binds these on its global site.mousetrap; this makes one for the page, and returns it.
export const bind = (ctrl: AnalysisCtrl): Mousetrap => {
  // Trim: lila also listens for a tap of shift (select the next continuation) or ctrl
  // (fold variations) on its own (addModifierKeyListeners).
  const kbd = new Mousetrap();
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
    .bind('l', () => ctrl.cevalEnabled(!ctrl.cevalEnabled()));
  // Trim: lila also has b (board editor), ? (keyboard help), v (variation arrows), x (threat),
  // and e (opening explorer).

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
