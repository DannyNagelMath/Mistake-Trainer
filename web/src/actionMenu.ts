// actionMenu.ts: the menu that the ☰ button opens over the move list. From lila's
// ui/analyse/src/view/actionMenu.ts (master, commit 27ffc8b), keeping only what works here.
// Every change from lila's version is marked with a comment starting "Trim:".

import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { i18n } from './i18n';
import { licon } from './licon';
import { bind, hl } from './snabbdom';

// Trim: lila's menu also has the board editor, practice with the computer, continue from here
// (against the computer or a friend), study, clear local data, the settings dialog, and replay
// mode (autoplay). They need a Lichess server, the engine, or settings we don't keep.
export function view(ctrl: AnalysisCtrl): VNode {
  // Trim: lila also checks it isn't an embedded board. Not in lila: never for cards, whose panel stays open.
  const canRetro = ctrl.hasFullComputerAnalysis() && !ctrl.retro && !ctrl.card;

  const tools = [
    hl('div.action-menu__tools', [
      hl(
        'a',
        {
          hook: bind('click', () => {
            ctrl.flip();
            ctrl.actionMenu.toggle();
            ctrl.redraw();
          }),
          attrs: { 'data-icon': licon.ChasingArrows, title: 'Hotkey: f' },
        },
        i18n.site.flipBoard,
      ),
      canRetro &&
        hl(
          'a',
          { hook: bind('click', ctrl.toggleRetro, ctrl.redraw), attrs: { 'data-icon': licon.GraduateCap } },
          i18n.site.learnFromYourMistakes,
        ),
    ]),
  ];

  return hl('div.action-menu.sub-box.reduced', [hl('div.title', i18n.site.analysis), hl('div.inner', [tools])]);
}
