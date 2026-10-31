// view.ts: the page, rendered with snabbdom using lila's elements and class names.
// Sources in lila (27ffc8b): ui/analyse/src/view/main.ts (analyseView),
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
import { renderStats } from './statsView';
import { bindNonPassive, hl } from './snabbdom';

// Like lila's ground.ts render, followed by the relevant part of AnalyseCtrl.setChessground.
// lila puts a counter in the class (cgv1, cgv2, ...) and raises it to force a brand-new board:
// a different class makes snabbdom replace the element, and the insert hook makes a new board.
// We raise it for every card (AnalysisCtrl.loadGame).
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
      // Not in lila, which replaces boards rarely. Chessground listens on the whole page
      // (for dragging and resizing), and destroy removes those listeners. snabbdom destroys the
      // old element before inserting the new one, so ctrl.cg is still the old board here.
      destroy: () => ctrl.cg?.destroy(),
    },
  });
}

// lila's renderPlayerStrips (view/components.ts): above and below the board, the material
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

// Like lila's renderBoard, with the player strips; the mouse wheel over the board steps through
// the moves. Trim: no promotion chooser, no player bars (lila's, in studies and broadcasts), and no
// setting to turn the wheel off (scrollMoves).
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

// Like lila's renderTools (view/tools.ts): the engine's box and line, once a card is done
// (isCevalAllowed); the move list; the choice of continuations; the panel; and the ☰ menu, which
// the CSS places over the move list. Trim: no explorer or practice mode, and lila hides the engine
// on a phone unless you ask (showCeval).
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

// Like lila's renderMoveList (view/tools.ts). div.analyse__moves is the part that scrolls.
// Trim: lila hides the moves in some studies, and adds a "next chapter" button in studies.
const renderMoveList = (ctrl: AnalysisCtrl): VNode =>
  hl('div.analyse__moves.areplay', { hook: ctrl.treeView.hook() }, [
    hl('div', [ctrl.treeView.render(), renderResult(ctrl)]),
  ]);

// Like lila's analyseView and renderMain, in lila's order; the CSS grid places the parts. lila
// builds the variant class from the game; the deck's are all standard chess. data-active-tool and
// data-active-mode are for the phone layout's CSS (snabbdom leaves out an attribute that's false).
// Trim: no underboard (lila's tabs under the board), and of lila's state classes, only gauge-on.
// Not in lila: with a deck, the progress box goes in the side panel, under the game's details,
// where it's in view without scrolling on wide screens.
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
      deck?.statsOpen && renderStats(deck), // and "Your stats", from the progress box
    ],
  );
}
