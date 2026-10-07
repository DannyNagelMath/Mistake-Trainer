// dashboardView.ts: Not in lila. Draws the dashboard (see dashboard.ts): how your cards stand, the
// settings form, and your suspended cards, each on a small board.

import { Chessground } from '@lichess-org/chessground';
import { uciToMove } from '@lichess-org/chessground/util';
import { opposite } from 'chessops';
import type { VNode } from 'snabbdom';

import type { DashboardCtrl } from './dashboard';
import type { Card } from './deck';
import { isAlreadyWon, isCollapse, isOpening, progress } from './schedule';
import { fixProblems, newCardOrders, problems, ranges, type NewCardOrder, type Settings } from './settings';
import { hl, onInsert, type LooseVNodes } from './snabbdom';
import { buildTree, mainline, type LichessGameJson } from './tree';

export function view(ctrl: DashboardCtrl): VNode {
  return hl('main.page-small.box.box-pad.mt-dashboard', [
    hl('h1.box__top', 'Dashboard'),
    renderCounts(ctrl),
    renderSettings(ctrl),
    renderSuspended(ctrl),
  ]);
}

// The settings the counts are worked out with: the form's, so you can see what a change would do
// before saving it, except that the saved one stands in for any that doesn't make sense yet.
const preview = (ctrl: DashboardCtrl): Settings => fixProblems(ctrl.draft, ctrl.saved);

// The same counts as the trainer's progress box.
function renderCounts(ctrl: DashboardCtrl): VNode {
  if (!ctrl.deck)
    return hl('p', 'No deck yet. Build one from web with: npx tsx scripts/buildDeck.ts <your Lichess username>');
  const p = progress(ctrl.deck.cards, ctrl.history, new Date(), preview(ctrl));
  return hl('p.mt-dashboard__counts', [
    `Your ${ctrl.deck.cards.length} cards: `,
    [`${p.mastered} mastered`, `${p.inRotation} in rotation`, `${p.notStarted} not started`, `${p.suspended} suspended`].join(
      ' · ',
    ),
  ]);
}

const orderLabels: Record<NewCardOrder, string> = {
  collapses: 'Collapses first',
  recent: 'Recent games first',
  openings: 'Openings first',
  random: 'Random',
};

// The form shows a number setting multiplied by `scale`: desired retention as a percentage.
const scales: Partial<Record<keyof Settings, number>> = { desiredRetention: 100 };

// The settings, from the form's inputs, which are named after them. A number that's empty or
// can't be read is NaN, which problems() reports, except that an empty new-card limit means none.
function readForm(form: HTMLFormElement): Settings {
  const input = (key: keyof Settings) => form.elements.namedItem(key) as HTMLInputElement;
  const num = (key: keyof Settings) => (input(key).value === '' ? NaN : Number(input(key).value) / (scales[key] ?? 1));
  const noLimit = input('newCardsPerDay').value === '' && !input('newCardsPerDay').validity.badInput;
  return {
    newCardOrder: input('newCardOrder').value as NewCardOrder,
    newCardsPerDay: noLimit ? null : num('newCardsPerDay'),
    collapseBefore: num('collapseBefore'),
    collapseAfter: num('collapseAfter'),
    openingMoves: num('openingMoves'),
    desiredRetention: num('desiredRetention'),
    minGapDays: num('minGapDays'),
    masteredDays: num('masteredDays'),
  };
}

function renderSettings(ctrl: DashboardCtrl): VNode {
  const shown = ctrl.filledIn;
  const wrong = problems(ctrl.draft);

  // The inputs show what the form was filled in with, as their starting value (the value
  // attribute), and the browser keeps what you type. They're only replaced, with new values, when
  // the form's key changes (resetToDefaults). Setting their current value on every redraw would
  // fight your typing: "-" on its way to "-2" reads as no number at all.
  const numberInput = (key: Exclude<keyof Settings, 'newCardOrder'>, step: number, placeholder?: string): VNode => {
    const scale = scales[key] ?? 1;
    const value = shown[key];
    return hl('input', {
      attrs: {
        type: 'number',
        id: key,
        name: key,
        min: ranges[key].min * scale,
        max: ranges[key].max * scale,
        step,
        value: value === null ? '' : String(Math.round(value * scale * 100) / 100),
        placeholder: placeholder ?? '',
      },
    });
  };

  // One setting: its label, its inputs (with any text around them), what's wrong with them, and
  // what the setting does.
  const row = (label: string, keys: (keyof Settings)[], control: LooseVNodes, help: string): VNode =>
    hl('div.mt-setting', [
      hl('label.mt-setting__label', { attrs: { for: keys[0] } }, label),
      hl('div.mt-setting__control', [
        control,
        ...keys.map(key => wrong[key] && hl('span.mt-setting__problem', wrong[key])),
      ]),
      hl('p.mt-setting__help', help),
    ]);

  return hl(
    'form.mt-settings',
    {
      key: 'form' + ctrl.formVersion,
      attrs: { novalidate: true }, // problems() checks the values, not the browser
      on: {
        input: e => ctrl.update(readForm(e.currentTarget as HTMLFormElement)),
        submit: e => {
          e.preventDefault();
          ctrl.save();
        },
      },
    },
    [
      hl('h2', 'New cards'),
      row(
        'Order',
        ['newCardOrder'],
        hl(
          'select',
          { attrs: { id: 'newCardOrder', name: 'newCardOrder' } },
          newCardOrders.map(order =>
            hl('option', { attrs: { value: order, selected: order === shown.newCardOrder } }, orderLabels[order]),
          ),
        ),
        'Which of the cards you haven’t started come up first. Positions that were already won ' +
          '(about +6 before your move and still +3 after it) always come last.',
      ),
      row(
        'Collapse',
        ['collapseBefore', 'collapseAfter'],
        [
          'better than ',
          numberInput('collapseBefore', 0.1),
          ' before your move, worse than ',
          numberInput('collapseAfter', 0.1),
          ' after it',
        ],
        'The evals that make a mistake a collapse, in pawns from your side: a winning or level game ' +
          'turned into a lost one. For “Collapses first”.',
      ),
      row(
        'Opening',
        ['openingMoves'],
        ['up to move ', numberInput('openingMoves', 1)],
        'Which mistakes count as opening mistakes, for “Openings first”.',
      ),
      renderCategoryCounts(ctrl),
      row(
        'New cards a day',
        ['newCardsPerDay'],
        numberInput('newCardsPerDay', 1, 'No limit'),
        'At most this many new cards in any 24 hours. Leave it empty for no limit.',
      ),

      hl('h2', 'Reviews'),
      row(
        'Desired retention',
        ['desiredRetention'],
        [numberInput('desiredRetention', 1), ' %'],
        'FSRS shows you each card again when it thinks your chance of still getting it right has ' +
          'dropped to this. Higher means shorter gaps and more reviews. It applies to your reviews from ' +
          'now on.',
      ),
      row(
        'Minimum gap',
        ['minGapDays'],
        [numberInput('minGapDays', 1), ' days'],
        'No card comes back sooner than this after you review it, so you work it out rather than ' +
          'recognise it. It applies to your reviews from now on: cards already scheduled keep their dates.',
      ),
      row(
        'Mastered',
        ['masteredDays'],
        ['once FSRS’s gap for a card is ', numberInput('masteredDays', 1), ' days or more'],
        'Mastered cards leave the regular reviews; “Practise mastered cards”, under the board, ' +
          'goes through them. A miss puts a card back in rotation.',
      ),

      hl('div.mt-settings__actions', [
        hl('button.button', { attrs: { type: 'submit', disabled: !ctrl.canSave() } }, 'Save'),
        hl(
          'button.button.button-empty',
          { attrs: { type: 'button' }, on: { click: ctrl.resetToDefaults } },
          'Reset to defaults',
        ),
        hl('span.mt-settings__message', ctrl.message || (ctrl.changed() ? 'Unsaved changes' : '')),
      ]),
    ],
  );
}

// How many cards each kind of new-card order puts first, with the form's settings.
function renderCategoryCounts(ctrl: DashboardCtrl): VNode | undefined {
  if (!ctrl.deck) return;
  const s = preview(ctrl);
  const count = (f: (c: Card) => boolean) => ctrl.deck!.cards.filter(f).length;
  return hl(
    'p.mt-settings__counts',
    `Of your ${ctrl.deck.cards.length} cards, ${count(c => isCollapse(c, s))} are collapses, ` +
      `${count(c => isOpening(c, s))} are from the opening, and ${count(isAlreadyWon)} were already won.`,
  );
}

function renderSuspended(ctrl: DashboardCtrl): VNode {
  const suspended = Object.entries(ctrl.history.suspended ?? {}).sort(([, a], [, b]) => b.localeCompare(a)); // latest first
  return hl('section.mt-suspended', [
    hl('h2', `Suspended cards (${suspended.length})`),
    suspended.length
      ? hl(
          'div.mt-suspended__list',
          suspended.map(([id, at]) => renderSuspendedCard(ctrl, id, at)),
        )
      : hl('p', 'None. “Suspend card”, at the top of the panel while you train, puts a card here.'),
  ]);
}

const color = { white: 'White', black: 'Black' };

const date = (t: number | string): string =>
  new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

// Each card has its own key, so that when one is unsuspended, snabbdom removes its element
// rather than reusing it, and its board, for the next card.
function renderSuspendedCard(ctrl: DashboardCtrl, id: string, at: string): VNode {
  const card = ctrl.deck?.cards.find(c => c.id === id);
  const game = card && ctrl.deck!.games[card.gameId];
  const opponent = card && game?.players?.[opposite(card.color)].user?.name;
  return hl('div.mt-suspended__card', { key: id }, [
    card && game ? renderMiniBoard(game, card) : hl('div.mt-suspended__missing', `${id}: not in the deck`),
    card && hl('div', `Move ${card.moveNumber} as ${color[card.color]}${opponent ? ` against ${opponent}` : ''}`),
    game?.createdAt ? hl('div', `Played ${date(game.createdAt)}`) : undefined,
    hl('div', `Suspended ${date(at)}`),
    hl('button.button.button-empty.button-thin', { on: { click: () => ctrl.unsuspend(id) } }, 'Unsuspend'),
  ]);
}

// The position you faced, before your mistake, with the move before it highlighted. Like lila's
// mini boards (ui/lib/src/view/miniBoard.ts initMiniBoardWith, master, commit 27ffc8b).
function renderMiniBoard(game: LichessGameJson, card: Card): VNode {
  const position = mainline(buildTree(game)).find(n => n.ply === card.ply - 1)!;
  return hl('div.mini-board.cg-wrap.is2d', {
    hook: onInsert(el =>
      Chessground(el, {
        coordinates: false,
        viewOnly: true,
        drawable: { enabled: false, visible: false },
        fen: position.fen,
        orientation: card.color,
        lastMove: uciToMove(position.uci),
      }),
    ),
  });
}
