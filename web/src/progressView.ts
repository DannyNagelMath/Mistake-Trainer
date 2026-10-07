// progressView.ts: the progress box under the controls, in place of lila's advice summary. It
// shows how your cards are spread (mastered, in rotation, not started, suspended), what's due
// now, and how many you've reviewed in the last 24 hours, with the button for practising
// mastered cards. Not in lila.

import type { VNode } from 'snabbdom';

import type { DeckCtrl } from './deckCtrl';
import { MASTERED_DAYS } from './schedule';
import { bind, hl } from './snabbdom';

const count = (n: number, label: string, title: string): VNode =>
  hl('div.mt-progress__count', { attrs: { title } }, [hl('strong', String(n)), hl('span', label)]);

export function renderProgress(deck: DeckCtrl): VNode {
  const p = deck.progress();
  return hl('div.analyse__round-training', [
    hl('div.mt-progress', [
      hl('div.mt-progress__counts', [
        count(p.mastered, 'mastered', `FSRS will next show them ${MASTERED_DAYS} or more days after your last review`),
        count(p.inRotation, 'in rotation', 'Started, and not yet mastered'),
        count(p.notStarted, 'not started', 'New cards'),
        p.suspended > 0 && count(p.suspended, 'suspended', 'Never shown again'),
      ]),
      hl('div.mt-progress__now', `Due now: ${p.dueNow} · Reviewed in the last 24 hours: ${p.reviewedLastDay}`),
      // Each button has its own key, so switching makes a new element: bind's click listener is
      // only added when an element is created.
      deck.practising
        ? hl(
            'button.button.button-empty',
            { key: 'back', hook: bind('click', () => deck.practise(false)) },
            'Back to regular reviews',
          )
        : hl(
            'button.button.button-empty',
            {
              key: 'practise',
              attrs: { disabled: p.masteredNow === 0, title: 'Mastered cards whose game is not waiting' },
              hook: bind('click', () => deck.practise(true)),
            },
            `Practise mastered cards (${p.masteredNow})`,
          ),
    ]),
  ]);
}
