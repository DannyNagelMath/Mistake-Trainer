// view.ts: the page, rendered with snabbdom using lila's elements and class names.
// Sources in lila (master, commit 27ffc8b): ui/analyse/src/view/main.ts (analyseView),
// view/components.ts (renderMain, renderBoard), view/tools.ts, view/controls.ts, and ground.ts.

import { Chessground } from '@lichess-org/chessground';
import { h, type VNode } from 'snabbdom';

import { view as actionMenu } from './actionMenu';
import type { AnalysisCtrl } from './analysisCtrl';
import { view as analysisSettingsView } from './analysisSettingsView';
import type { DeckCtrl } from './deckCtrl';
import renderClocks from './clocks';
import { stepwiseScroll } from './common';
import { renderResult } from './components';
import { renderCeval, renderPvs } from './cevalView';
import { renderControls } from './controls';
import { renderGauge } from './evalGauge';
import { view as forkView } from './fork';
import { renderMaterialDiffs } from './material';
import { renderProgress } from './progressView';
import retroView from './retroView';
import { render as trainingView } from './roundTraining';
import { renderSide } from './side';
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

// Step 8: lila's renderPlayerStrips (view/components.ts): above and below the board, the material
// each side is up and their clocks. The CSS hides them on narrow screens.
function renderPlayerStrips(ctrl: AnalysisCtrl): [VNode, VNode] {
  const renderPlayerStrip = (cls: string, materialDiff: VNode, clock?: VNode): VNode =>
    hl('div.analyse__player_strip.' + cls, [materialDiff, clock]);

  const clocks = renderClocks(ctrl, ctrl.path),
    whitePov = ctrl.bottomColor() === 'white',
    materialDiffs = renderMaterialDiffs(ctrl.bottomColor(), ctrl.node.fen);

  return [
    renderPlayerStrip('top', materialDiffs[0], clocks?.[whitePov ? 1 : 0]),
    renderPlayerStrip('bottom', materialDiffs[1], clocks?.[whitePov ? 0 : 1]),
  ];
}

// Like lila's renderBoard. Step 8: the player strips. Trim: no promotion chooser yet, and no
// player bars (lila shows those instead of strips in studies and broadcasts).
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
    [...renderPlayerStrips(ctrl), renderGround(ctrl)],
  );
}

// Like lila's renderTools (view/tools.ts). Step 5: the "Learn from your mistakes" panel.
// Step 6: the move list above it. Step 7: the choice of continuations, and the ☰ menu, which
// the CSS places over the move list.
// Trim: no explorer or practice mode.
// hl leaves out retroView's result when it's undefined, i.e. when the panel is closed.
// The engine's box and its line, above the move list, as in lila, only once a card is done
// (isCevalAllowed). Trim: lila doesn't show them on a phone unless you ask (showCeval).
function renderTools(ctrl: AnalysisCtrl): VNode {
  const showCeval = ctrl.isCevalAllowed();
  return hl('div.analyse__tools', [
    showCeval && renderCeval(ctrl),
    showCeval && renderPvs(ctrl),
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
// Step 8: the advice summary (trainingView) and the side panel, in lila's order. The CSS grid
// places them: on wide screens, the side panel left of the board, and the summary under the
// controls. Trim: no underboard, lila's tabs under the board, whose eval chart was little use
// here beside the evaluation gauge.
// Step 7: the data-active-tool and data-active-mode attributes, which the phone layout's CSS
// uses. snabbdom leaves an attribute out when its value is false.
// Trim: of lila's state classes, only gauge-on.
// Not in lila: with a deck, the progress box goes in the side panel, under the game's details,
// where it's in view without scrolling on wide screens. (trainingView shows nothing for cards.)
export function view(ctrl: AnalysisCtrl, deck?: DeckCtrl): VNode {
  // The evaluation gauge, beside the board: the gauge-on class makes room for it.
  // Trim: lila also tells the board to resize when the gauge comes or goes; the board notices by
  // itself here (chessground watches its size).
  const gaugeOn = ctrl.showEvalGauge();
  return hl(
    'main.analyse.variant-standard',
    {
      attrs: {
        'data-active-tool': ctrl.activeControlBarTool(),
        'data-active-mode': ctrl.activeControlMode(),
      },
      class: { 'gauge-on': gaugeOn },
    },
    [
      renderBoard(ctrl),
      gaugeOn && renderGauge(ctrl),
      renderTools(ctrl),
      renderControls(ctrl),
      trainingView(ctrl),
      renderSide(ctrl, deck && renderProgress(deck)),
      // Not in lila, whose dialogs add themselves to the page: the menu's Settings dialog, while open.
      ctrl.settingsOpen && analysisSettingsView(ctrl),
    ],
  );
}
