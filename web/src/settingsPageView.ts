// settingsPageView.ts: Not in lila. Draws Training settings (see settingsPage.ts): how your cards
// stand, how often you find the move, the settings form, updating your deck, the computer analysis
// of your games, and your suspended cards, each on a small board you can click to look at it up
// close.

import { Chessground } from '@lichess-org/chessground';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { uciToMove } from '@lichess-org/chessground/util';
import { opposite, type Color } from 'chessops';
import type { VNode } from 'snabbdom';

import type { AnalysisRun } from './analysisRun';
import { renderRun } from './analysisRunView';
import { clickedOutside } from './analysisSettingsView';
import { makeShapesFromUci } from './autoShape';
import { renderEval, renderIndex } from './components';
import type { SettingsPageCtrl } from './settingsPage';
import { gameTimesOf, type Card } from './deck';
import { failureReason } from './deckUpdate';
import { i18n } from './i18n';
import { licon } from './licon';
import { activeCards, isAlreadyWon, isCollapse, isOpening, progress, recentGames } from './schedule';
import { fixProblems, newCardOrders, problems, ranges, type NewCardOrder, type NumberKey, type Settings } from './settings';
import { answerRates, type AnswerRates, type Rate } from './reviews';
import { analysisSource } from './side';
import { hl, onInsert, type LooseVNodes } from './snabbdom';
import { buildTree, mainline, type LichessGameJson, type TreeNode } from './tree';

export function view(ctrl: SettingsPageCtrl): VNode {
  return hl('main.page-small.box.box-pad.mt-settings-page', [
    hl('h1.box__top', 'Training settings'),
    renderCounts(ctrl),
    renderRates(ctrl),
    renderSettings(ctrl),
    renderYourDeck(ctrl),
    renderComputerAnalysis(ctrl),
    renderSuspended(ctrl),
    ctrl.looking && renderLook(ctrl, ctrl.looking),
  ]);
}

// The settings the counts are worked out with: the form's, so you can see what a change would do
// before saving it, except that the saved one stands in for any that doesn't make sense yet.
const preview = (ctrl: SettingsPageCtrl): Settings => fixProblems(ctrl.draft, ctrl.saved);

// The same counts as the trainer's progress box.
function renderCounts(ctrl: SettingsPageCtrl): VNode {
  const p = progress(ctrl.deck.cards, ctrl.history, new Date(), preview(ctrl));
  return hl('p.mt-settings-page__counts', [
    `Your ${ctrl.deck.cards.length} cards: `,
    [`${p.started} started`, `${p.notStarted} not started`, `${p.suspended} suspended`].join(' · '),
  ]);
}

// How often you find the move (reviews.ts answerRates), over all your reviews and, once some are
// older than that, the last 30 days, so you can see whether it's changing. Until then the two would
// be the same.
function renderRates(ctrl: SettingsPageCtrl): VNode | undefined {
  const log = ctrl.history.log;
  if (!log.length) return;
  const all = answerRates(log);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const lately = new Date(log[0].log.review) < monthAgo ? answerRates(log, monthAgo) : undefined; // oldest first
  const cell = (r: Rate) => hl('td', r.of ? `${Math.round((100 * r.right) / r.of)}% (${r.right} of ${r.of})` : '–');
  const row = (label: string, key: keyof AnswerRates) =>
    hl('tr', [hl('th', label), cell(all[key]), lately && cell(lately[key])]);
  return hl('div.mt-rates', [
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
      `When cards come back, FSRS aims for ${Math.round(preview(ctrl).desiredRetention * 100)}% right: ` +
        'your desired retention, below.',
    ),
  ]);
}

// When your deck was built, and "Update deck" (deckUpdate.ts): it downloads the games you've played
// since and builds the deck again, as npm run update-deck does, showing what it prints as it goes.
// Once it's done, the page loads again with the new deck when you say so: not by itself, as that
// would pause the computer analysis, if it's running.
function renderYourDeck(ctrl: SettingsPageCtrl): VNode {
  const update = ctrl.deckUpdate;
  const state = update.status?.state;
  return hl('section.mt-your-deck', [
    hl('h2', 'Your deck'),
    hl(
      'p',
      `Built ${date(ctrl.deck.builtAt)}, at ${time(ctrl.deck.builtAt)}. “Update deck” downloads the games you’ve ` +
        'played since from Lichess, then builds your deck again, with the cards from the new games Lichess has ' +
        'analysed, and from the games analysed here (Computer analysis, below). Your reviews stay as they are.',
    ),
    update.error && hl('p.mt-run__error', update.error),
    update.newDeck()
      ? [
          hl('p', doneText(ctrl)),
          hl('button.button', { attrs: { type: 'button' }, on: { click: reloadToTrain } }, 'Reload'),
        ]
      : [
          state === 'failed' && renderFailure(update.status!.lines),
          hl(
            'button.button',
            { attrs: { type: 'button', disabled: state === 'running' }, on: { click: update.start } },
            state === 'running' ? 'Updating…' : 'Update deck',
          ),
        ],
    (state === 'running' || state === 'failed' || update.newDeck()) &&
      update.status!.lines.length > 0 &&
      renderLog(update.status!.lines),
  ]);
}

// e.g. "Done: your deck now has 3,762 cards, 12 more than before. Reload the page to train with them."
function doneText(ctrl: SettingsPageCtrl): string {
  const built = ctrl.deckUpdate.built;
  if (!built) return 'Done. Reload the page to train with your new deck.';
  const count = (n: number) => n.toLocaleString('en');
  const change = built.cards.length - ctrl.deck.cards.length;
  return (
    `Done: your deck now has ${count(built.cards.length)} cards, ` +
    (change > 0 ? `${count(change)} more` : change < 0 ? `${count(-change)} fewer` : 'as many') +
    ' than before. Reload the page to train with them.' +
    (ctrl.yourGames.loaded?.run.running ? ' That pauses the computer analysis below: carry on after.' : '')
  );
}

// Why the update stopped, if what it printed says, as it may be well up in the box below.
function renderFailure(lines: string[]): VNode {
  const reason = failureReason(lines);
  return hl('p.mt-run__error', [
    'The update stopped, so your deck is as it was.',
    reason ? [hl('br'), reason] : ' What it printed is below.',
  ]);
}

// What the update has printed, in a box that keeps its latest lines in view.
const renderLog = (lines: string[]): VNode =>
  hl(
    'pre.mt-your-deck__log',
    { hook: { insert: v => scrollToEnd(v.elm), postpatch: (_, v) => scrollToEnd(v.elm) } },
    [lines.join('\n')],
  );
const scrollToEnd = (el: Node | undefined) => (el as HTMLElement).scrollTo(0, (el as HTMLElement).scrollHeight);

// Back to training, with the new deck: the page loads again, without #settings.
function reloadToTrain(): void {
  window.history.replaceState(null, '', location.pathname);
  location.reload();
}

// Your games (yourGames.ts): how many Lichess has analysed, the run on the others, here, and whether
// the deck has the cards from those analysed here yet.
function renderComputerAnalysis(ctrl: SettingsPageCtrl): VNode {
  const { loaded, error } = ctrl.yourGames;
  const count = (n: number) => n.toLocaleString('en');
  return hl('section.mt-computer-analysis', [
    hl('h2', 'Computer analysis'),
    loaded
      ? [
          hl(
            'p',
            `Your cards come from the computer analysis of your games. Lichess has analysed ` +
              `${count(loaded.byLichess)} of your ${count(loaded.all)} games. The other ` +
              `${count(loaded.run.games.length)} can be analysed here, on your computer, the way Lichess’s servers ` +
              'do it, newest first. Each game is saved as soon as it’s done, so you can pause, or close the page, ' +
              'and carry on later. It goes on while you train, stopping whenever the trainer’s own engine is ' +
              'thinking.',
          ),
          renderRun(loaded.run),
          renderNotInDeck(ctrl, loaded.run),
        ]
      : hl('p', error || 'Loading your games…'),
  ]);
}

// The games analysed here join the deck when it's built again (scripts/buildDeck.ts), so the ones
// analysed since it was built aren't in it yet.
function renderNotInDeck(ctrl: SettingsPageCtrl, run: AnalysisRun): VNode | undefined {
  const analysed = run.games.filter(g => run.saved[g.id]);
  if (!analysed.length) return undefined;
  const since = analysed.filter(g => run.saved[g.id].at > ctrl.deck.builtAt).length;
  return hl(
    'p',
    since
      ? `Games analysed here since your deck was built: ${since.toLocaleString('en')}. To add their cards, ` +
          'use “Update deck”, above.'
      : 'Your deck has the cards from all the games analysed here so far.',
  );
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
// can't be read is NaN, which problems() reports, except that an empty new-card limit means none,
// and empty "Recent games" means all your games.
function readForm(form: HTMLFormElement): Settings {
  const input = (key: keyof Settings) => form.elements.namedItem(key) as HTMLInputElement;
  const num = (key: keyof Settings) => (input(key).value === '' ? NaN : Number(input(key).value) / (scales[key] ?? 1));
  const empty = (key: keyof Settings) => input(key).value === '' && !input(key).validity.badInput;
  const noLimit = empty('newCardsPerDay');
  return {
    recentGames: empty('recentGames') ? null : num('recentGames'),
    newCardOrder: input('newCardOrder').value as NewCardOrder,
    newCardsPerDay: noLimit ? null : num('newCardsPerDay'),
    collapseBefore: num('collapseBefore'),
    collapseAfter: num('collapseAfter'),
    openingMoves: num('openingMoves'),
    desiredRetention: num('desiredRetention'),
    minGapDays: num('minGapDays'),
    gameRestDays: num('gameRestDays'),
    bestMoveOnly: input('bestMoveOnly').checked,
  };
}

function renderSettings(ctrl: SettingsPageCtrl): VNode {
  const shown = ctrl.filledIn;
  const wrong = problems(ctrl.draft);

  // The inputs show what the form was filled in with, as their starting value (the value
  // attribute), and the browser keeps what you type. They're only replaced, with new values, when
  // the form's key changes (resetToDefaults). Setting their current value on every redraw would
  // fight your typing: "-" on its way to "-2" reads as no number at all.
  const numberInput = (key: NumberKey, step: number, placeholder?: string): VNode => {
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
        'Recent games',
        ['recentGames'],
        ['from your last ', numberInput('recentGames', 1, 'all'), ' games'],
        'New cards only come from your latest games, this many. The cards you’ve started keep coming ' +
          'back, whatever their game. To move on to older games, raise it. Leave it empty for all your ' +
          'games. It counts your games with computer analysis, mistakes or not.',
      ),
      renderRecentCounts(ctrl),
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
        'Same game',
        ['gameRestDays'],
        ['wait ', numberInput('gameRestDays', 1), ' days before another card from it'],
        'After you review a card, the other cards from its game wait this long, so you don’t see two ' +
          'positions from one game too close together. 0 means no wait. They only wait in the queue: ' +
          'their schedules don’t change.',
      ),

      hl('h2', 'Answers'),
      row(
        'Right answers',
        ['bestMoveOnly'],
        [
          hl('input', { attrs: { type: 'checkbox', id: 'bestMoveOnly', name: 'bestMoveOnly', checked: shown.bestMoveOnly } }),
          ' only the engine’s best move',
        ],
        'On: only the engine’s best move counts as right. Off: moves nearly as good also count, as on ' +
          'Lichess. Either way, a checkmate counts, and so do moves masters have played in the opening.',
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

// What "Recent games" takes in, with the form's settings, e.g. "Your last 100 games, back to Sep 5,
// 2025, have 299 cards, 260 of them not started."
function renderRecentCounts(ctrl: SettingsPageCtrl): VNode | undefined {
  const s = preview(ctrl);
  if (s.recentGames === null) return;
  const times = gameTimesOf(ctrl.deck);
  const recent = recentGames(times, s);
  if (!recent) return hl('p.mt-settings__counts', `That’s all your ${times.length.toLocaleString('en')} games.`);
  const cards = ctrl.deck.cards.filter(c => c.playedAt >= recent.since);
  const notStarted = activeCards(cards, ctrl.history).filter(c => !ctrl.history.cards[c.id]).length;
  const games =
    recent.games === 1 ? `Your last game, on ${date(recent.since)}, has` : (
      `Your last ${recent.games} games, back to ${date(recent.since)}, have`
    );
  return hl(
    'p.mt-settings__counts',
    `${games} ${cards.length} card${cards.length === 1 ? '' : 's'}, ${notStarted} of them not started.`,
  );
}

// How many cards each kind of new-card order puts first, with the form's settings.
function renderCategoryCounts(ctrl: SettingsPageCtrl): VNode {
  const s = preview(ctrl);
  const count = (f: (c: Card) => boolean) => ctrl.deck.cards.filter(f).length;
  return hl(
    'p.mt-settings__counts',
    `Of your ${ctrl.deck.cards.length} cards, ${count(c => isCollapse(c, s))} are collapses, ` +
      `${count(c => isOpening(c, s))} are from the opening, and ${count(isAlreadyWon)} were already won.`,
  );
}

function renderSuspended(ctrl: SettingsPageCtrl): VNode {
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
const time = (t: number | string): string => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// e.g. "Move 20 as White against RealAgentCooper"
function caption(card: Card, game: LichessGameJson): string {
  const opponent = game.players?.[opposite(card.color)].user?.name;
  return `Move ${card.moveNumber} as ${color[card.color]}${opponent ? ` against ${opponent}` : ''}`;
}

// Each card has its own key, so that when one is unsuspended, snabbdom removes its element
// rather than reusing it, and its board, for the next card.
function renderSuspendedCard(ctrl: SettingsPageCtrl, id: string, at: string): VNode {
  const card = ctrl.deck.cards.find(c => c.id === id);
  const game = card && ctrl.deck.games[card.gameId];
  return hl('div.mt-suspended__card', { key: id }, [
    card && game
      ? hl(
          'button.mt-suspended__look',
          { attrs: { type: 'button', title: 'Look at it up close' }, on: { click: () => ctrl.look(id) } },
          renderMiniBoard(positionBefore(game, card), card.color),
        )
      : hl('div.mt-suspended__missing', `${id}: not in the deck`),
    card && game && hl('div', caption(card, game)),
    game?.createdAt ? hl('div', `Played ${date(game.createdAt)}`) : undefined,
    hl('div', `Suspended ${date(at)}`),
    hl('button.button.button-empty.button-thin', { on: { click: () => ctrl.unsuspend(id) } }, 'Unsuspend'),
  ]);
}

// The position you faced: the game's, before your mistake.
const positionBefore = (game: LichessGameJson, card: Card): TreeNode =>
  mainline(buildTree(game)).find(n => n.ply === card.ply - 1)!;

// A position, with the move before it highlighted, and any arrows. Like lila's mini boards
// (ui/lib/src/view/miniBoard.ts initMiniBoardWith, master, commit 27ffc8b).
// Chessground draws the arrows for the board's size. In the closer look, the board is put in the
// page before its dialog opens (snabbdom runs a dialog's insert hook after its contents'), so it
// has no size yet then, and waits for the next frame.
function renderMiniBoard(position: TreeNode, orientation: Color, arrows: DrawShape[] = []): VNode {
  return hl('div.mini-board.cg-wrap.is2d', {
    hook: onInsert(el => {
      const init = () =>
        Chessground(el, {
          coordinates: false,
          viewOnly: true,
          drawable: { enabled: false, visible: arrows.length > 0, autoShapes: arrows },
          fen: position.fen,
          orientation,
          lastMove: uciToMove(position.uci),
        });
      if (el.offsetWidth) init();
      else requestAnimationFrame(init);
    }),
  });
}

// A closer look at a suspended card, to see why you suspended it: the position, with your move as
// a red arrow and the analysis's best move as a blue one, as the trainer draws them, and what the
// computer analysis said, and where it was made. In lila's dialog, like the board's Settings
// (analysisSettingsView.ts), so lila's CSS lays it out.
function renderLook(ctrl: SettingsPageCtrl, id: string): VNode | undefined {
  const card = ctrl.deck.cards.find(c => c.id === id);
  const game = card && ctrl.deck.games[card.gameId];
  if (!card || !game) return undefined;
  const line = mainline(buildTree(game));
  const at = line.findIndex(n => n.ply === card.ply);
  const [played, before] = [line[at], line[at - 1]];
  const best = before.children.find(c => c.comp); // the analysis's line, beside your move
  const comment = played.comments?.find(c => c.by === 'lichess')?.text; // e.g. "Blunder. Nb5 was best."
  const yourTime = line[Math.max(0, at - 2)].clock; // after your move before this one, or at the start
  const suspended = ctrl.history.suspended?.[id];
  // The game on Lichess, from your side, at the position you faced: lila's analysis board starts
  // at the ply after the # (AnalyseCtrl.makeInitialPath).
  const onLichess = `https://lichess.org/${game.id}/${card.color}#${card.ply - 1}`;
  const close = (e: Event) => (e.currentTarget as HTMLElement).closest('dialog')!.close();
  return hl(
    'dialog.mt-look',
    {
      hook: onInsert<HTMLDialogElement>(el => el.showModal()),
      on: {
        close: () => ctrl.look(undefined), // also after Escape, which closes an open dialog by itself
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
      hl(
        'div.scrollable',
        hl('div.dialog-content', [
          hl('h2', caption(card, game)),
          hl('div.mt-look__body', [
            hl(
              'div.mt-look__board',
              renderMiniBoard(before, card.color, [
                ...makeShapesFromUci(played.uci, 'paleRed', { lineWidth: 8 }),
                ...makeShapesFromUci(played.eval?.best, 'paleBlue'),
              ]),
            ),
            hl('div.mt-look__info', [
              hl('p', [
                'You played ',
                hl('span.mt-look__moves', [renderIndex(played.ply, true), played.san, played.glyphs?.[0]?.symbol]),
                ` (${evalText(before.eval)} → ${evalText(played.eval)})`,
              ]),
              comment && hl('p', comment),
              best && hl('p.mt-look__moves', lineMoves(best)),
              hl('p', analysisSource(game)),
              yourTime !== undefined && hl('p', `You had ${clockTime(yourTime)} left on your clock.`),
              hl(
                'p.mt-look__dates',
                [game.createdAt && `Played ${date(game.createdAt)}`, suspended && `Suspended ${date(suspended)}`]
                  .filter(Boolean)
                  .join(' · '),
              ),
              hl('div.mt-look__actions', [
                hl('button.button.button-empty', { on: { click: () => ctrl.unsuspend(id) } }, 'Unsuspend'),
                hl(
                  'a.button.button-empty',
                  {
                    attrs: {
                      href: onLichess,
                      target: '_blank',
                      rel: 'noopener',
                      title:
                        'Opens the game on Lichess, at this position, in a new tab. ' +
                        (game.analysedHere
                          ? 'Lichess hasn’t analysed this game: this analysis was made on your computer.'
                          : 'Lichess shows the analysis of the whole game, so also the answers to your other ' +
                            'cards from it.'),
                    },
                  },
                  'Open on Lichess',
                ),
              ]),
            ]),
          ]),
        ]),
      ),
    ],
  );
}

// An evaluation from the computer analysis, as the move list writes it: e.g. "+0.8", "−2.7", or "#3"
// for mate in 3.
const evalText = (e: TreeNode['eval']): string =>
  (e?.cp !== undefined ? renderEval(e.cp) : e?.mate !== undefined ? `#${e.mate}` : '?').replace('-', '−');

// A line of moves from a node on, numbered as the move list does: e.g. "20.Qxg7+ Kxg7 21.Nf5+",
// or "20...Kxg7 21.Nf5+" from a black move.
function lineMoves(first: TreeNode): LooseVNodes[] {
  const moves: LooseVNodes[] = [];
  for (let node: TreeNode | undefined = first; node; node = node.children[0])
    moves.push([node !== first && ' ', (node === first || node.ply % 2 === 1) && renderIndex(node.ply, true), node.san]);
  return moves;
}

// A clock's time, e.g. "0:39", "4:59", or "1:05:00" over an hour.
function clockTime(centis: number): string {
  const seconds = Math.floor(centis / 100);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
