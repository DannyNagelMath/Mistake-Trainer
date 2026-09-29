// view.ts: the page, rendered with snabbdom using lila's elements and class names.
// Sources in lila (master, commit 27ffc8b): ui/analyse/src/view/main.ts (analyseView),
// view/components.ts (renderMain, renderBoard), view/tools.ts, view/controls.ts, and ground.ts.

import { Chessground } from '@lichess-org/chessground';
import { h, type VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderResult } from './components';
import retroView from './retroView';
import { hl } from './snabbdom';

// Like lila's ground.ts render, followed by the relevant part of AnalyseCtrl.setChessground.
// lila puts a counter in the class (cgv1, cgv2, ...) and raises it to force a brand-new board.
// We never need that, so it stays cgv1. As in lila there's no destroy hook: this element is
// created once and never removed, so the board lives as long as the page.
function renderGround(ctrl: AnalysisCtrl): VNode {
  return h('div.cg-wrap.cgv1', {
    hook: {
      insert: vnode => {
        const config = ctrl.cgConfig();
        ctrl.cg = Chessground(vnode.elm as HTMLElement, {
          ...config,
          movable: { ...config.movable, free: false, events: { after: ctrl.userMove } },
        });
        ctrl.setAutoShapes(); // lila's setChessground ends by calling setAutoShapes too
      },
    },
  });
}

// Like lila's renderBoard. Trim: no player strips, promotion chooser, or scroll-wheel navigation yet.
function renderBoard(ctrl: AnalysisCtrl): VNode {
  return h('div.analyse__board.main-board', [renderGround(ctrl)]);
}

// Like lila's renderTools (view/tools.ts). Step 5: the "Learn from your mistakes" panel.
// Step 6: the move list above it.
// Trim: no engine lines, explorer, practice mode, or action menu.
// hl leaves out retroView's result when it's undefined, i.e. when the panel is closed.
function renderTools(ctrl: AnalysisCtrl): VNode {
  return hl('div.analyse__tools', [renderMoveList(ctrl), retroView(ctrl)]);
}

// Step 6: like lila's renderMoveList (view/tools.ts). div.analyse__moves is the part that scrolls.
// Trim: lila hides the moves in some studies, and adds a "next chapter" button in studies.
const renderMoveList = (ctrl: AnalysisCtrl): VNode =>
  hl('div.analyse__moves.areplay', { hook: ctrl.treeView.hook() }, [
    hl('div', [ctrl.treeView.render(), renderResult(ctrl)]),
  ]);

// Empty for now. Step 7 fills it in from lila's renderControls.
function renderControls(): VNode {
  return h('div.analyse__controls.analyse-controls');
}

// Like lila's analyseView and renderMain. lila builds the class from the game's variant;
// the fixtures are all standard chess.
// Trim: no data-active-tool / data-active-mode attributes or state classes (comp-off, gauge-on, ...) yet.
export function view(ctrl: AnalysisCtrl): VNode {
  return h('main.analyse.variant-standard', [renderBoard(ctrl), renderTools(ctrl), renderControls()]);
}