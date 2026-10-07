// underboard.ts: Step 8. The tabs under the board. lila's server writes them
// (modules/analyse/src/main/ui/ReplayUi.scala), and ui/analyse/src/serverSideUnderboard.ts makes
// them work (master, commit 27ffc8b). Every change from lila's version is marked with a comment
// starting "Trim:".

import type { VNode } from 'snabbdom';

import { acplChart, type AcplChart } from './acpl';
import type { AnalysisCtrl } from './analysisCtrl';
import { i18n } from './i18n';
import { hl } from './snabbdom';

// The chart on the page, and the move its orange line is at.
let chart: AcplChart | undefined;
let shown = { ply: -1, onMainline: true };

// Moves the chart's orange line to the move on the board, like lila's pubsub message 'ply'.
function selectPly(ctrl: AnalysisCtrl): void {
  if (!chart || (shown.ply === ctrl.node.ply && shown.onMainline === ctrl.onMainline)) return;
  shown = { ply: ctrl.node.ply, onMainline: ctrl.onMainline };
  chart.selectPly(shown.ply, shown.onMainline);
}

// Trim: only the "Computer analysis" tab. lila also has "Move times" (a chart of the time spent
// on each move), "Crosstable" (results between the two players), and "Share & export" (FEN,
// PGN, images, and links). And it offers to request an analysis for games without one.
// Not in lila: no chart while hiding hints (AnalysisCtrl.hidingHints); its drop shows where the
// mistake is. It comes back, as a new chart, once the card is done.
export function renderUnderboard(ctrl: AnalysisCtrl): VNode | undefined {
  if (!ctrl.hasFullComputerAnalysis() || ctrl.hidingHints()) return undefined;
  return hl('div.analyse__underboard', [
    hl('div.analyse__underboard__menu', { attrs: { role: 'tablist' } }, [
      hl(
        'button.computer-analysis.active',
        { attrs: { role: 'tab', 'data-panel': 'computer-analysis', title: i18n.site.computerAnalysis } },
        i18n.site.computerAnalysis,
      ),
    ]),
    hl('div.analyse__underboard__panels', [
      hl('div.computer-analysis.active', [
        hl('div#acpl-chart-container', [
          hl('canvas#acpl-chart', {
            // Step 9: a new key for every card's game, so snabbdom replaces the canvas and the
            // hooks make a new chart for the new game.
            key: ctrl.cgVersion,
            hook: {
              insert: vnode => {
                chart = acplChart(vnode.elm as HTMLCanvasElement, ctrl.mainline, index => {
                  ctrl.jumpToIndex(index);
                  ctrl.redraw();
                });
                shown = { ply: -1, onMainline: true };
                selectPly(ctrl);
              },
              update: () => selectPly(ctrl),
              destroy: () => {
                chart?.destroy();
                chart = undefined;
              },
            },
          }),
        ]),
      ]),
    ]),
  ]);
}
