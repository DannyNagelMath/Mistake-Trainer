// evalGauge.ts: the evaluation gauge, the bar beside the board that shows who's better. From
// lila's ui/lib/src/ceval/view/main.ts (27ffc8b), renderGauge and getBestEval.

import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { hl } from './snabbdom';
import { povChances, type EvalScore } from './winningChances';

// The engine's evaluation of the position if there is one, else the game's computer analysis's.
export const getBestEval = (ctrl: AnalysisCtrl): EvalScore | undefined => {
  return ctrl.node.ceval ?? (ctrl.showEvaluation() ? ctrl.node.eval : undefined);
};

let gaugeLast = 0;
let gaugeTicks: VNode[];

// Trim: lila also hides it during a game that's still being played (ctrl.ongoing).
export function renderGauge(ctrl: AnalysisCtrl): VNode | undefined {
  if (!ctrl.showEvalGauge()) return undefined;
  gaugeTicks ??= Array.from({ length: 7 }, (_, i) =>
    hl('tick', { class: { zero: i === 3 }, attrs: { style: `height: ${(i + 1) * 12.5}%` } }),
  );
  const bestEv = getBestEval(ctrl);
  let ev;
  if (bestEv) {
    ev = povChances('white', bestEv);
    gaugeLast = ev;
  } else ev = gaugeLast;
  return hl(
    'div.eval-gauge',
    {
      class: { empty: bestEv === undefined, reverse: ctrl.bottomColor() === 'black' },
      attrs: { style: `--eval-percent: ${100 - (ev + 1) * 50}%` },
    },
    gaugeTicks,
  );
}
