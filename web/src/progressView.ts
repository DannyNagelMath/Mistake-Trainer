// progressView.ts: the progress box, in the side panel under the game's details (side.ts): on
// wide screens, that's the space left of the board, which lila leaves to the chat. It shows how
// your cards are spread (started, not started, suspended) and how many are due now, or if none
// are, when the next ones are. Not in lila.

import type { VNode } from 'snabbdom';

import type { DeckCtrl } from './deckCtrl';
import type { Progress } from './schedule';
import { hl } from './snabbdom';

const count = (n: number, label: string, title: string): VNode =>
  hl('div.mt-progress__count', { attrs: { title } }, [hl('strong', String(n)), hl('span', label)]);

// When the next cards come up (schedule.ts nextDue): how many that day, and when the first of them
// does, e.g. "Next: 45 on Thu, Oct 29, from 3:57 PM", "Next: 3 today, from 7:12 PM", or
// "Next: 1 tomorrow, at 9:05 AM". The others come up later that day, each at the time of day it was
// last reviewed, plus the minimum gap.
export function describeNext(next: NonNullable<Progress['nextDue']>, now: Date): string {
  const day = new Date(next.at);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const when =
    day.toDateString() === now.toDateString() ? 'today'
    : day.toDateString() === tomorrow.toDateString() ? 'tomorrow'
    : `on ${day.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
  const time = day.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Next: ${next.count} ${when}, ${next.count > 1 ? 'from' : 'at'} ${time}`;
}

export function renderProgress(deck: DeckCtrl): VNode {
  const p = deck.progress();
  return hl('div.mt-progress', [
    hl('div.mt-progress__counts', [
      count(p.started, 'started', 'Reviewed at least once'),
      count(p.notStarted, 'not started', 'New cards'),
      p.suspended > 0 && count(p.suspended, 'suspended', 'Not shown until you bring them back in Training settings'),
    ]),
    // Each on a line of its own, as the next cards' day and time don't fit on one line beside it.
    hl('div.mt-progress__now', [
      hl('div', `Due now: ${p.dueNow}`),
      p.dueNow === 0 && p.nextDue && hl('div', describeNext(p.nextDue, new Date())),
    ]),
  ]);
}
