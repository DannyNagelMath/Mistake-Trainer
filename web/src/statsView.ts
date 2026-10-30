// statsView.ts: Not in lila. "Your stats", which the link in the progress box opens (progressView.ts):
// how often you've found the move (reviews.ts answerRates), over all your reviews and, once some are
// older than that, the last 30 days, so you can see whether it's changing. Until then the two would
// be the same. In lila's dialog, like the board's Settings dialog (analysisSettingsView.ts).

import type { VNode } from 'snabbdom';

import { clickedOutside } from './analysisSettingsView';
import type { DeckCtrl } from './deckCtrl';
import { i18n } from './i18n';
import { licon } from './licon';
import { answerRates, type AnswerRates, type Rate } from './reviews';
import { hl, onInsert } from './snabbdom';

export function renderStats(deck: DeckCtrl): VNode {
  const close = (e: Event) => (e.currentTarget as HTMLElement).closest('dialog')!.close();
  return hl(
    'dialog.mt-stats',
    {
      hook: onInsert<HTMLDialogElement>(el => el.showModal()),
      on: {
        close: deck.closeStats, // also after Escape, which closes an open dialog by itself
        click: e => clickedOutside(e) && close(e),
      },
    },
    [
      hl(
        'div.close-button-anchor',
        hl('button.close-button', {
          attrs: { 'data-icon': licon.X, 'aria-label': i18n.site.close },
          on: { click: close },
        }),
      ),
      hl('div.scrollable', hl('div.dialog-content', [hl('h2', 'Your stats'), renderRates(deck)])),
    ],
  );
}

function renderRates(deck: DeckCtrl): VNode | VNode[] {
  const log = deck.history.log;
  if (!log.length) return hl('p', 'No reviews yet.');
  const all = answerRates(log);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const lately = new Date(log[0].log.review) < monthAgo ? answerRates(log, monthAgo) : undefined; // oldest first
  const cell = (r: Rate) => hl('td', r.of ? `${Math.round((100 * r.right) / r.of)}% (${r.right} of ${r.of})` : '–');
  const row = (label: string, key: keyof AnswerRates) =>
    hl('tr', [hl('th', label), cell(all[key]), lately && cell(lately[key])]);
  return [
    hl('table', [
      hl('caption', 'How often you found the move'),
      hl('thead', hl('tr', [hl('th'), hl('th', 'All your reviews'), lately && hl('th', 'Last 30 days')])),
      hl('tbody', [
        row('The first time', 'firstTime'),
        row('When a card came back', 'cameBack'),
        row('… after getting it wrong', 'afterWrong'),
        row('… after getting it right', 'afterRight'),
      ]),
    ]),
    hl(
      'p',
      `When cards come back, FSRS aims for ${Math.round(deck.settings.desiredRetention * 100)}% right: ` +
        'your desired retention, in Training settings.',
    ),
  ];
}
