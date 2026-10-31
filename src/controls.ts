// controls.ts: the bar under the move list, with the first / previous / next / last buttons and
// the menu button. From lila's ui/analyse/src/view/controls.ts (master, commit 27ffc8b).
// Every change from lila's version is marked with a comment starting "Trim:".

import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { addPointerListeners, blurIfPrimaryClick, repeater } from './common';
import { i18n } from './i18n';
import { licon } from './licon';
import { hl, onInsert } from './snabbdom';

// Trim: lila also has 'opening-explorer', 'analysis' (a study's practice), and 'engine-mode'.
type Action = 'first' | 'prev' | 'next' | 'last' | 'menu';

export function renderControls(ctrl: AnalysisCtrl) {
  const canJumpPrev = ctrl.path !== '',
    canJumpNext = !!ctrl.node.children[0];

  // One listener for the whole bar; each button says what it does in its data-act attribute.
  return hl(
    'div.analyse__controls.analyse-controls',
    {
      hook: onInsert(el =>
        addPointerListeners(el, {
          click: e => clickControl(ctrl, e),
          hold: e => holdControl(ctrl, e),
        }),
      ),
    },
    [
      hl('div.jumps', [
        jumpButton(licon.JumpFirst, 'first', canJumpPrev),
        jumpButton(licon.LessThan, 'prev', canJumpPrev),
        jumpButton(licon.GreaterThan, 'next', canJumpNext),
        jumpButton(licon.JumpLast, 'last', ctrl.node !== ctrl.mainline[ctrl.mainline.length - 1]),
      ]),
      // Trim: lila puts the opening explorer and "practice with computer" buttons here, and on
      // phones a tab for the engine or the retro panel.
      hl('button.fbt', {
        class: { active: ctrl.activeControlBarTool() === 'action-menu' },
        attrs: { title: i18n.site.menu, 'data-act': 'menu', 'data-icon': licon.Hamburger },
      }),
    ],
  );
}

// Holding down prev or next keeps stepping; holding any other button counts as a click.
function holdControl(ctrl: AnalysisCtrl, e: PointerEvent) {
  if (!(e.target instanceof HTMLElement)) return;
  const action = e.target.closest<HTMLElement>('[data-act]')?.dataset.act as Action;
  if (action === 'prev' || action === 'next') {
    repeater(() => {
      ctrl.navigate[action]();
      ctrl.redraw();
    });
  } else clickControl(ctrl, e);
}

function clickControl(ctrl: AnalysisCtrl, e: PointerEvent) {
  if (!(e.target instanceof HTMLElement)) return;
  const action = e.target.closest<HTMLElement>('[data-act]')?.dataset.act as Action;
  if (!action) return;
  if (action === 'prev') ctrl.navigate.prev();
  else if (action === 'next') ctrl.navigate.next();
  else if (action === 'first') ctrl.navigate.first();
  else if (action === 'last') ctrl.navigate.last();
  else if (action === 'menu') ctrl.toggleActionMenu();
  blurIfPrimaryClick(e);
  ctrl.redraw();
}

const jumpButton = (icon: string, effect: Action, enabled: boolean): VNode =>
  hl('button.fbt.move', { attrs: { disabled: !enabled, 'data-act': effect, 'data-icon': icon } });
