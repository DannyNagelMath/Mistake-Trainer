// view.ts: the page, rendered with snabbdom using lila's elements and class names.
// Sources in lila (master, commit 27ffc8b): ui/analyse/src/view/main.ts (analyseView),
// view/components.ts (renderMain, renderBoard), view/tools.ts, view/controls.ts, and ground.ts.

import { Chessground } from '@lichess-org/chessground';
import { h, type VNode } from 'snabbdom';

import { view as actionMenu } from './actionMenu';
import type { AnalysisCtrl } from './analysisCtrl';
import { stepwiseScroll } from './common';
import { renderResult } from './components';
import { renderControls } from './controls';
import { view as forkView } from './fork';
import retroView from './retroView';
import { bindNonPassive, hl } from './snabbdom';

// Like lila's ground.ts render, followed by the relevant part of AnalyseCtrl.setChessground.
// lila puts a counter in the class (cgv1, cgv2, ...) and raises it to force a brand-new board:
// a different class makes snabbdom replace the element, and the insert hook makes a new board.
// Step 9: we raise it for every card (AnalysisCtrl.loadGame).
function renderGround(ctrl: AnalysisCtrl): VNode {
  return h('div.cg-wrap.cgv' + ctrl.cgVersion, {
    hook: {
      insert: vnode => {
        const config = ctrl.cgConfig();
        ctrl.cg = Chessground(vnode.elm as HTMLElement, {
          ...config,
          movable: { ...config.movable, free: false, events: { after: ctrl.userMove } },
        });
        ctrl.setAutoShapes(); // lila's setChessground ends by calling setAutoShapes too
      },
      // Step 9: not in lila, which replaces boards rarely. Chessground listens on the whole page
      // (for dragging and resizing), and destroy removes those listeners. snabbdom destroys the
      // old element before inserting the new one, so ctrl.cg is still the old board here.
      destroy: () => ctrl.cg?.destroy(),
    },
  });
}

// Like lila's renderBoard. Trim: no player strips or promotion chooser yet.
// Step 7: scrolling the mouse wheel over the board steps through the moves.
// Trim: lila lets you turn that off in the settings (scrollMoves).
function renderBoard(ctrl: AnalysisCtrl): VNode {
  return h(
    'div.analyse__board.main-board',
    {
      hook:
        'ontouchstart' in window
          ? undefined
          : bindNonPassive(
              'wheel',
              stepwiseScroll(
                e => {
                  if (e.deltaY > 0) ctrl.navigate.next();
                  else if (e.deltaY < 0) ctrl.navigate.prev();
                  ctrl.redraw();
                },
                // only on the squares and pieces. Trim: lila also skips it in interactive lessons (gamebooks).
                e => !['PIECE', 'SQUARE', 'CG-BOARD'].includes((e.target as HTMLElement).tagName),
              ),
            ),
    },
    [renderGround(ctrl)],
  );
}

// Like lila's renderTools (view/tools.ts). Step 5: the "Learn from your mistakes" panel.
// Step 6: the move list above it. Step 7: the choice of continuations, and the ☰ menu, which
// the CSS places over the move list.
// Trim: no engine lines, explorer, or practice mode.
// hl leaves out retroView's result when it's undefined, i.e. when the panel is closed.
function renderTools(ctrl: AnalysisCtrl): VNode {
  return hl('div.analyse__tools', [
    renderMoveList(ctrl),
    forkView(ctrl),
    retroView(ctrl),
    ctrl.actionMenu() && actionMenu(ctrl),
  ]);
}

// Step 6: like lila's renderMoveList (view/tools.ts). div.analyse__moves is the part that scrolls.
// Trim: lila hides the moves in some studies, and adds a "next chapter" button in studies.
const renderMoveList = (ctrl: AnalysisCtrl): VNode =>
  hl('div.analyse__moves.areplay', { hook: ctrl.treeView.hook() }, [
    hl('div', [ctrl.treeView.render(), renderResult(ctrl)]),
  ]);

// Like lila's analyseView and renderMain. lila builds the class from the game's variant;
// the fixtures are all standard chess.
// Step 7: the data-active-tool and data-active-mode attributes, which the phone layout's CSS
// uses. snabbdom leaves an attribute out when its value is false.
// Trim: no state classes (comp-off, gauge-on, ...) yet.
export function view(ctrl: AnalysisCtrl): VNode {
  return h(
    'main.analyse.variant-standard',
    {
      attrs: {
        'data-active-tool': ctrl.activeControlBarTool(),
        'data-active-mode': ctrl.activeControlMode(),
      },
    },
    [renderBoard(ctrl), renderTools(ctrl), renderControls(ctrl)],
  );
}
