// howItWorks.ts: Not in lila. "How it works", a few lines about the trainer, from the first-run
// screen (setupView.ts) and the progress box (progressView.ts). In lila's dialog, like Your stats
// (statsView.ts), added to the page while it's open, so neither page keeps track of it.

import { init, attributesModule, classModule, eventListenersModule, propsModule } from 'snabbdom';

import { clickedOutside } from './analysisSettingsView';
import { i18n } from './i18n';
import { licon } from './licon';
import { hl, onInsert } from './snabbdom';

const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

export function showHowItWorks(): void {
  const close = (e: Event) => (e.currentTarget as HTMLElement).closest('dialog')!.close();
  // snabbdom puts the dialog in this element's place.
  patch(
    document.body.appendChild(document.createElement('dialog')),
    hl(
      'dialog.mt-how-it-works',
      {
        hook: onInsert<HTMLDialogElement>(el => el.showModal()),
        on: {
          close: e => (e.currentTarget as HTMLElement).remove(), // also after Escape, which closes it by itself
          click: e => clickedOutside(e) && close(e),
        },
      },
      [
        hl(
          'div.close-button-anchor',
          hl('button.close-button', { attrs: { 'data-icon': licon.X, 'aria-label': i18n.site.close }, on: { click: close } }),
        ),
        hl('div.scrollable', hl('div.dialog-content', [hl('h2', 'How it works'), ...text.map(p => hl('p', p))])),
      ],
    ),
  );
}

const text = [
  'Each card is a position from one of your Lichess games where you made a mistake, found the way ' +
    'Lichess’s “Learn from your mistakes” finds them, from the game’s computer analysis. Find a better ' +
    'move than the one you played.',
  'The analysis’s move counts as right, and so does any move Stockfish finds nearly as good, or, in the ' +
    'opening, one masters have played. Only your first try counts. After a right move, say how it went: ' +
    'Worked it out, Looked familiar, or Knew it instantly.',
  'Each card comes back when you’re about to forget it, as FSRS, the scheduler Anki uses, works out from ' +
    'your answers: sooner after a miss, later and later as you keep getting it right. But never within ' +
    '5 days, by default, so that you work the position out again rather than remember it.',
  'New cards come from your last 20 games, by default, positions you threw away first: a winning or ' +
    'level game turned into a lost one. Cards you’ve started keep coming back, whatever their game.',
  'Training settings, at the top right, is where to change these numbers, and where “Update deck” adds ' +
    'the cards from the games you’ve played since.',
];
