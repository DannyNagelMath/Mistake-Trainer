// setupView.ts: Not in lila. The first-run screen, until there's a deck with cards: you give your
// Lichess username, the page downloads your games and builds your deck (deckUpdate.ts), and then
// loads again, with the trainer. If none of your games has computer analysis, it offers to analyse
// them here first (yourGames.ts). It shows in Training settings' <main> (index.html), in its style.

import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import { importData } from './backup';
import type { Deck } from './deck';
import { DeckUpdateCtrl } from './deckUpdate';
import type { Speed } from './gameDownload';
import { signedIn, signOut } from './lichessAuth';
import { defaultSettings } from './settings';
import {
  checkedGameTypes,
  renderAbout,
  renderComputerAnalysis,
  renderGameTypes,
  renderLog,
  renderSignIn,
} from './settingsPageView';
import { hl } from './snabbdom';
import { loadSettings, saveSettings } from './storage';
import { YourGamesCtrl } from './yourGames';

const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

// `deck`: the deck there is, if any, which has no cards.
export async function showSetup(deck: Deck | undefined): Promise<void> {
  const settings = await loadSettings().catch(() => defaultSettings); // for the kinds of games
  document.body.classList.add('mt-settings-shown'); // this page's <main>, not the trainer's
  document.querySelector<HTMLElement>('.site-buttons')!.style.display = 'none'; // Training settings needs a deck
  let vnode: VNode | Element = document.querySelector('main.mt-settings-page')!;
  let update: DeckUpdateCtrl | undefined;
  let problem = ''; // what's wrong with the form, if anything
  // With a deck but no cards, as none of your games has computer analysis: analysing them here.
  let yourGames: YourGamesCtrl | undefined;
  const analyseHere = (username: string, gameTypes: Speed[]): void => {
    yourGames = new YourGamesCtrl(username, () => gameTypes, redraw);
    yourGames.load();
  };

  const redraw = (): void => {
    vnode = patch(vnode, view());
    if (update?.state === 'done' && update.built?.cards.length) location.reload(); // on to the trainer
  };
  // Saves the kinds of games you chose, for later updates too, then builds your deck.
  const start = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value.trim();
    const gameTypes = checkedGameTypes(form);
    if (update?.state === 'running' || !username) return;
    problem = gameTypes.length ? '' : 'Choose at least one kind of game.';
    if (problem) return redraw();
    await saveSettings({ ...settings, gameTypes });
    update = new DeckUpdateCtrl(username, () => gameTypes, redraw);
    await update.start();
    if (update.built && !update.built.cards.length) analyseHere(username, gameTypes);
  };

  const view = (): VNode => {
    const running = update?.state === 'running';
    const built = update ? update.built : deck;
    return hl('main.page-small.box.box-pad.mt-settings-page', [
      hl('h1.box__top', 'Mistake Trainer'),
      hl(
        'p',
        'Practise the mistakes from your own Lichess games, with spaced repetition. Each card is a position ' +
          'where you went wrong, to solve as in Lichess’s “Learn from your mistakes”.',
      ),
      hl(
        'p',
        'To begin, the page downloads your games of the kinds you choose from Lichess, and finds your ' +
          'mistakes in the ones with computer analysis.',
      ),
      renderSignIn(async () => {
        await signOut();
        redraw();
      }),
      hl('form.mt-setup', { on: { submit: start } }, [
        hl('div.mt-setup__row', ['Games: ', ...renderGameTypes(settings.gameTypes)]),
        hl('div.mt-setup__row', [
          hl('label', { attrs: { for: 'username' } }, 'Your Lichess username'),
          hl('input', {
            attrs: { id: 'username', name: 'username', required: true, value: signedIn()?.username ?? deck?.username ?? '' },
          }),
          hl(
            'button.button',
            { attrs: { type: 'submit', disabled: running } },
            running ? 'Building your deck…' : yourGames ? 'Build my deck' : 'Start',
          ),
        ]),
      ]),
      hl('p.mt-setup__import', [
        'Moving here with a file you exported from Mistake Trainer? ',
        hl('a', { on: { click: importData } }, 'Import it'),
      ]),
      problem && hl('p.mt-run__error', problem),
      built && !built.cards.length && [
        hl('p.mt-run__error', noCards(built)),
        yourGames &&
          renderComputerAnalysis(
            yourGames,
            run =>
              run.games.some(g => run.saved[g.id]) &&
              hl('p', 'Once some are analysed, press “Build my deck”, above, to make your cards from them.'),
          ),
      ],
      update?.state === 'failed' && hl('p.mt-run__error', update.lines.at(-1)!),
      update && update.lines.length > 0 && renderLog(update.lines),
      renderAbout(),
    ]);
  };

  if (deck && !deck.cards.length) analyseHere(deck.username, settings.gameTypes);
  redraw();
}

// Why a deck has no cards.
const noCards = (deck: Deck): string =>
  deck.gameTimes?.length
    ? `None of ${deck.username}’s ${deck.gameTimes.length} games with computer analysis has a mistake by them.`
    : `None of ${deck.username}’s games has computer analysis yet. Lichess analyses a game when you ask it ` +
      'to, on the game’s page, or you can analyse them here, below.';
