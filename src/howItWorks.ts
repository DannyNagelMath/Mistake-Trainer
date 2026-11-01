// howItWorks.ts: Not in lila. "How it works", a few lines about the trainer, folded away until you
// open it: on the first-run screen (setupView.ts) and at the top of Training settings.

import type { VNode } from 'snabbdom';

import { hl } from './snabbdom';

export const renderHowItWorks = (): VNode =>
  hl('details.mt-fold.mt-how-it-works', [hl('summary', 'How it works'), ...text.map(p => hl('p', p))]);

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
  'You can change these numbers in Training settings, where “Update deck” also adds the cards from the ' +
    'games you’ve played since.',
];
