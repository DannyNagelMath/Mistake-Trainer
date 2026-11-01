// howItWorks.ts: Not in lila. "How it works", a few lines about the trainer, folded away until you
// open it: on the first-run screen (setupView.ts) and at the top of Training settings.

import type { VNode } from 'snabbdom';

import { hl } from './snabbdom';

export const renderHowItWorks = (): VNode =>
  hl('details.mt-fold.mt-how-it-works', [hl('summary', 'How it works'), ...text.map(p => hl('p', p))]);

const text = [
  'Each card is a position from one of your computer-analysed Lichess games where you made a mistake. ' +
    'Mistakes are found the same way as in Lichess’s “Learn from your mistakes”. Your goal is to find a ' +
    'better move than the one you played.',
  'Only your first try counts. After a right move say how it went with Worked it out, Looked familiar or ' +
    'Knew it instantly.',
  'FSRS (the scheduler Anki uses) brings each card back when you’re about to forget it.',
  'In Training settings you can change how long cards wait before coming back, which cards come first and ' +
    'how many recent games new cards come from (your last 20 to begin with).',
  'Mistake Trainer can also analyse the games Lichess hasn’t, the way Lichess does. Run it on your own ' +
    'computer (see Source code below) for the full-strength engine.',
];
