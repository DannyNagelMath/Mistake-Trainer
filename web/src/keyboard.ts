// keyboard.ts: keyboard shortcuts for the analysis page. From lila's ui/analyse/src/keyboard.ts
// (master, commit 27ffc8b). Every change from lila's version is marked with a comment starting "Trim:".
//
//   left or k: previous move         right or j: next move
//   up, 0, or home: first move       down, $, or end: last move
//   up / down when there's a choice of continuations: change which one "next" follows
//   shift+left / shift+right (or shift+k / shift+j): previous / next variation
//   shift+c: show or hide comments   shift+i: inline or two-column move list
//   h: open or close the menu        f: flip the board

import type { AnalysisCtrl } from './analysisCtrl';
import Mousetrap from './mousetrap';

// Trim: lila binds these on its global site.mousetrap; this makes one for the page.
export const bind = (ctrl: AnalysisCtrl) => {
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
    .bind('shift+i', () => {
      // Trim: lila's settings.set also saves the choice for next time.
      ctrl.settings.inline = !ctrl.settings.inline;
      ctrl.redraw();
    });
  // Trim: lila's space bar plays the engine's best move, or turns the engine on.

  kbd
    .bind('h', () => {
      ctrl.toggleActionMenu();
      ctrl.redraw();
    })
    .bind('f', ctrl.flip);
  // Trim: lila also has b (board editor), ? (keyboard help), l (engine), z (computer analysis),
  // a (best move arrows), v (variation arrows), x (threat), and e (opening explorer).

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
};
