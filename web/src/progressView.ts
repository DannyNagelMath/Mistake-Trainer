// progressView.ts: the progress box, in the side panel under the game's details (side.ts): on
// wide screens, that's the space left of the board, which lila leaves to the chat. It shows how
// your cards are spread (started, not started, suspended) and how many are due now, or if none
// are, when the next ones are. Not in lila.

import type { VNode } from 'snabbdom';

import type { DeckCtrl } from './deckCtrl';
import { hl } from './snabbdom';

const count = (n: number, label: string, title: string): VNode =>
  hl('div.mt-progress__count', { attrs: { title } }, [hl('strong', String(n)), hl('span', label)]);

export function renderProgress(deck: DeckCtrl): VNode {
  const p = deck.progress();
  return hl('div.mt-progress', [
    hl('div.mt-progress__counts', [
      count(p.started, 'started', 'Reviewed at least once'),
      count(p.notStarted, 'not started', 'New cards'),
      p.suspended > 0 && count(p.suspended, 'suspended', 'Not shown until you bring them back in Training settings'),
    ]),
    hl('div.mt-progress__now', [
      `Due now: ${p.dueNow}`,
      p.dueNow === 0 &&
        p.nextDue &&
        ` · next: ${p.nextDue.count} on ${new Date(p.nextDue.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`,
    ]),
  ]);
}
