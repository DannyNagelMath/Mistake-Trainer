// retroView.ts: the "Learn from your mistakes" panel, from lila's
// ui/analyse/src/retrospect/retroView.ts (27ffc8b).
// Not in lila: card mode (see retroCtrl.ts): every part that uses `ctrl.card`.

import { opposite, type Color } from 'chessops';
import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderIndexAndMove } from './components';
import { i18n } from './i18n';
import { licon } from './licon';
import type { RetroCtrl } from './retroCtrl';
import { bind, hl } from './snabbdom';
import type { TreeNode } from './tree';

// ---------- Stand-ins for things lila imports from its lib ----------

// Trim: copied from lila's ui/lib/src/game/chess.ts.
const capitalize = (color: Color): Capitalize<Color> => (color === 'white' ? 'White' : 'Black');

// Trim: lila writes icon(licon.PlayTriangle)(), from ui/lib/src/view/snabbdomElements.ts,
// which makes this element. The CSS shows its data-icon character in the icon font.
const icon = (code: string): VNode => hl('icon', { attrs: { 'data-icon': code } });

// ---------- Everything below is lila's code except where marked ----------

const skipOrViewSolution = (ctrl: RetroCtrl): VNode =>
  hl('div.choices', [
    hl('a', { hook: bind('click', ctrl.viewSolution, ctrl.redraw) }, i18n.site.viewTheSolution),
    hl('a', { hook: bind('click', ctrl.skip) }, i18n.site.skipThisMove),
  ]);

const jumpToNext = (ctrl: RetroCtrl): VNode =>
  hl('a.half.continue', { hook: bind('click', ctrl.jumpToNext) }, [icon(licon.PlayTriangle), i18n.site.next]);

// In card mode, after the right first move, the buttons for how it went, in place of Next
// until you choose. The labels aren't lila's.
const renderRatingChoices = (choices: { label: string; rate: () => void }[]): VNode =>
  hl(
    'div.half.rating',
    choices.map(c => hl('button.button', { hook: bind('click', c.rate) }, c.label)),
  );

// Once you've answered a card that has come up before, how you did last time, e.g.
// "Last time (Oct 12): wrong, you played Qh4." Not while you're still looking for the move, when it
// could give the answer away. Reviews from before October 29, 2026 didn't save the move.
function renderLastTime(ctrl: RetroCtrl): VNode | undefined {
  const last = ctrl.card?.lastTime;
  if (!last) return;
  const at = new Date(last.log.review);
  const date = at.toLocaleDateString([], {
    year: at.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const san = last.move?.san;
  const gameMove = !!last.move && last.move.uci === ctrl.current()?.fault.node.uci;
  const what = {
    win: san ? `right, with ${san}` : 'right',
    fail: san ? `wrong, you played ${san}` + (gameMove ? ', the game’s move' : '') : 'wrong',
    view: 'you looked at the solution',
    skip: 'you skipped it',
  }[last.result];
  return hl('div.mt-last-time', `Last time (${date}): ${what}.`);
}

// Fills as the engine searches deeper, while it checks a move that is neither the game move nor
// the engine's.
const minDepth = 8;
const maxDepth = 18;

const renderEvalProgress = (node: TreeNode): VNode =>
  hl(
    'div.progress',
    hl('div', {
      attrs: {
        style: `width: ${
          node.ceval ? (100 * Math.max(0, node.ceval.depth - minDepth)) / (maxDepth - minDepth) + '%' : 0
        }`,
      },
    }),
  );

const feedback = {
  find(ctrl: RetroCtrl): VNode[] {
    const findBetter = i18n.site[`findBetterMoveFor${capitalize(ctrl.color)}`];
    return [
      hl('div.player', [
        hl('div.no-square', hl('piece.king.' + ctrl.color)),
        hl(
          'div.instruction',
          // Not in lila: a card doesn't name the move you played ("20.Qh4?? was played").
          ctrl.card
            ? [hl('strong', findBetter), skipOrViewSolution(ctrl)]
            : [
                hl(
                  'strong',
                  i18n.site.xWasPlayed.asArray(hl('move', renderIndexAndMove(ctrl.current()!.fault.node, false, true))),
                ),
                hl('em', findBetter),
                skipOrViewSolution(ctrl),
              ],
        ),
      ]),
    ];
  },
  // user has browsed away from the move to solve
  offTrack(ctrl: RetroCtrl): VNode[] {
    return [
      hl('div.player', [
        hl('div.icon.off', '!'),
        hl('div.instruction', [
          hl('strong', i18n.site.youBrowsedAway),
          hl('div.choices.off', [hl('a', { hook: bind('click', ctrl.jumpToNext) }, i18n.site.resumeLearning)]),
        ]),
      ]),
    ];
  },
  fail(ctrl: RetroCtrl): VNode[] {
    return [
      hl('div.player', [
        hl('div.icon', '✗'),
        hl('div.instruction', [
          hl('strong', i18n.site.youCanDoBetter),
          hl('em', i18n.site[`tryAnotherMoveFor${capitalize(ctrl.color)}`]),
          skipOrViewSolution(ctrl),
        ]),
      ]),
    ];
  },
  win(ctrl: RetroCtrl): VNode[] {
    const choices = ctrl.card?.ratingChoices();
    return [
      hl(
        'div.half.top',
        hl('div.player', [
          hl('div.icon', '✓'),
          hl('div.instruction', [
            hl('strong', i18n.study.goodMove),
            choices && hl('em', 'How did you find it?'),
            renderLastTime(ctrl),
          ]),
        ]),
      ),
      choices ? renderRatingChoices(choices) : jumpToNext(ctrl),
    ];
  },
  view(ctrl: RetroCtrl): VNode[] {
    return [
      hl(
        'div.half.top',
        hl('div.player', [
          hl('div.icon', '✓'),
          hl('div.instruction', [
            hl('strong', i18n.site.solution),
            hl(
              'em',
              i18n.site.bestWasX.asArray(hl('strong', renderIndexAndMove(ctrl.current()!.solution.node, false, false))),
            ),
            renderLastTime(ctrl),
          ]),
        ]),
      ),
      jumpToNext(ctrl),
    ];
  },
  eval(ctrl: RetroCtrl): VNode[] {
    return [
      hl(
        'div.half.top',
        hl(
          'div.player.center',
          hl('div.instruction', [hl('strong', i18n.site.evaluatingYourMove), renderEvalProgress(ctrl.node())]),
        ),
      ),
    ];
  },
  end(ctrl: RetroCtrl, hasFullComputerAnalysis: () => boolean): VNode[] {
    if (!hasFullComputerAnalysis())
      return [
        hl(
          'div.half.top',
          // Trim: no loading spinner, which needs an SVG mask from lila's page; our games come analysed, so it never shows.
          hl('div.player', [hl('div.icon'), hl('div.instruction', i18n.site.waitingForAnalysis)]),
        ),
      ];
    // In card mode, nothing more is due. The text isn't one of lila's translations.
    if (ctrl.card)
      return [
        hl('div.player', [
          hl('div.no-square', hl('piece.king.' + ctrl.color)),
          hl('div.instruction', [
            hl('em', ctrl.card.summary()),
            hl('div.choices.end', [
              hl('a', { key: 'restart', hook: bind('click', ctrl.card.restart) }, 'Check for due cards'),
            ]),
          ]),
        ]),
      ];
    const nothing = !ctrl.completion()[1];
    return [
      hl('div.player', [
        hl('div.no-square', hl('piece.king.' + ctrl.color)),
        hl('div.instruction', [
          hl(
            'em',
            nothing
              ? i18n.site[`noMistakesFoundFor${capitalize(ctrl.color)}`]
              : i18n.site[`doneReviewing${capitalize(ctrl.color)}Mistakes`],
          ),
          hl('div.choices.end', [
            !nothing &&
              hl(
                'a',
                {
                  key: 'reset',
                  hook: bind('click', ctrl.reset),
                },
                i18n.site.doItAgain,
              ),
            hl(
              'a',
              {
                key: 'flip',
                hook: bind('click', ctrl.flip),
              },
              i18n.site[`review${capitalize(opposite(ctrl.color))}Mistakes`],
            ),
          ]),
        ]),
      ]),
    ];
  },
};

function renderFeedback(root: AnalysisCtrl, fb: Exclude<keyof typeof feedback, 'end'>) {
  const ctrl: RetroCtrl = root.retro!;
  const current = ctrl.current();
  if (ctrl.isSolving() && current && root.path !== current.prev.path) return feedback.offTrack(ctrl);
  if (fb === 'find') return current ? feedback.find(ctrl) : feedback.end(ctrl, root.hasFullComputerAnalysis);
  return feedback[fb](ctrl);
}

export default function (root: AnalysisCtrl): VNode | undefined {
  const ctrl = root.retro;
  if (!ctrl) return undefined;
  const fb = ctrl.feedback(),
    completion = ctrl.completion();
  return hl('div.retro-box.training-box.sub-box', [
    hl('div.title', [
      // For cards, neither the title nor the count (the progress box has the numbers): the
      // bar only holds "Suspend card".
      !ctrl.card && [
        hl('span', i18n.site.learnFromYourMistakes),
        hl('span', `${Math.min(completion[0] + 1, completion[1])} / ${completion[1]}`),
      ],
      // Not in lila: a card's panel has no close button; closing it would leave the card half done.
      !ctrl.card &&
        hl('button.fbt', {
          hook: bind('click', root.toggleRetro, root.redraw),
          attrs: { 'data-icon': licon.X, 'aria-label': 'Close learn window' },
        }),
      // Not in lila: show or hide the move you played in the game, as lila's pale red arrow.
      ctrl.card &&
        ctrl.current() &&
        hl(
          'a.my-move',
          { attrs: { title: 'The move you played in the game, as a red arrow' }, hook: bind('click', root.toggleBadMoveArrow) },
          root.showBadMoveArrow() ? 'Hide my move' : 'Show my move',
        ),
      // In card mode, while a card is shown, suspend it. It asks first, as undoing it means
      // going to Training settings.
      ctrl.card &&
        ctrl.current() &&
        hl(
          'a.suspend',
          {
            attrs: { title: 'Take this card out of your training. You can bring it back in Training settings.' },
            hook: bind('click', () => {
              if (confirm("Suspend this card? It won't come up until you bring it back in Training settings."))
                ctrl.card!.suspend();
            }),
          },
          'Suspend card',
        ),
    ]),
    hl('div.feedback.' + fb, renderFeedback(root, fb)),
  ]);
}
