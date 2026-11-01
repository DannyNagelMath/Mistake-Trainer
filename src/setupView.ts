// setupView.ts: Not in lila. The first-run screen, until there's a deck with cards: you give your
// Lichess username, the page downloads your games and builds your deck (deckUpdate.ts), and then
// loads again, with the trainer. If none of your games has computer analysis, it offers to analyse
// them here first (yourGames.ts). Only the kinds of games and your username show at first; How it
// works and signing in are folded away. It shows in Training settings' <main> (index.html), in its style.

import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import { importData, trySample } from './backup';
import type { Deck } from './deck';
import { DeckUpdateCtrl } from './deckUpdate';
import type { Speed } from './gameDownload';
import { renderHowItWorks } from './howItWorks';
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
  let settings = await loadSettings().catch(() => defaultSettings); // for the kinds of games
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
  // The kinds of games you tick are saved as you tick them, so that they're still ticked after
  // signing in, which goes to Lichess's page and back.
  const choose = (e: Event): void => {
    if ((e.target as HTMLInputElement).name !== 'gameTypes') return;
    const gameTypes = checkedGameTypes(e.currentTarget as HTMLFormElement);
    if (!gameTypes.length) return;
    settings = { ...settings, gameTypes };
    saveSettings(settings).catch(() => {}); // Start saves them again, and says if that fails
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
    settings = { ...settings, gameTypes };
    await saveSettings(settings);
    update = new DeckUpdateCtrl(username, () => gameTypes, redraw);
    await update.start();
    if (update.built && !update.built.cards.length) analyseHere(username, gameTypes);
  };

  const signOutAndRedraw = async (): Promise<void> => {
    await signOut();
    redraw();
  };

  const view = (): VNode => {
    const running = update?.state === 'running';
    const built = update ? update.built : deck;
    return hl('main.page-small.box.box-pad.mt-settings-page', [
      hl('h1.box__top', 'Spaced repetition from your Lichess games'),
      hl('p', 'Each card is a position where you went wrong, as in Lichess’s “Learn from your mistakes”.'),
      hl('form.mt-setup', { on: { submit: start, input: choose } }, [
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
        hl('p.mt-setup__link', [
          // The sample only before there's a deck: a deck without cards has your account, and maybe
          // analyses made here.
          !deck && [
            'Just looking? ',
            hl('a', { attrs: { title: 'Made from 20 of the author’s Lichess games' }, on: { click: trySample } }, 'Try a sample deck'),
            '. ',
          ],
          'Have an export? ',
          hl('a', { on: { click: importData } }, 'Import it'),
          '.',
        ]),
        renderHowItWorks(),
        // Signing in, which few need at first, folded away; once you have, who as, and Sign out.
        signedIn()
          ? renderSignIn(signOutAndRedraw)
          : hl('details.mt-fold', [hl('summary', 'Sign in with Lichess (optional)'), renderSignIn(signOutAndRedraw, true)]),
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
  deck.gameTimes.length
    ? `None of ${deck.username}’s ${deck.gameTimes.length} games with computer analysis has a mistake by them.`
    : `None of ${deck.username}’s games has computer analysis yet. Lichess analyses a game when you ask it ` +
      'to, on the game’s page, or you can analyse them here, below.';
