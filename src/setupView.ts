// setupView.ts: Not in lila. The first-run screen, until there's a deck with cards: you give your
// Lichess username, the page downloads your games and builds your deck (deckUpdate.ts), and then
// loads again, with the trainer. If none of your games has computer analysis, it offers to analyse
// them here first (yourGames.ts). It shows in Training settings' <main> (index.html), in its style.

import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import { importData, trySample } from './backup';
import type { Deck } from './deck';
import { DeckUpdateCtrl } from './deckUpdate';
import type { Speed } from './gameDownload';
import { showHowItWorks } from './howItWorks';
import { signedIn, signOut } from './lichessAuth';
import { defaultSettings, problems, type Settings } from './settings';
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

// Your choices on this screen, as settings, or what's wrong with them. Empty "Recent games" means
// all your games.
export function firstRunChoices(
  saved: Settings,
  gameTypes: Speed[],
  recentGames: string,
): { settings: Settings } | { problem: string } {
  const settings = { ...saved, gameTypes, recentGames: recentGames.trim() ? Number(recentGames) : null };
  const wrong = problems(settings);
  if (wrong.gameTypes) return { problem: 'Choose at least one kind of game.' };
  if (wrong.recentGames)
    return { problem: `New cards from your last … games: ${wrong.recentGames.toLowerCase()}, or empty for all.` };
  return { settings };
}

// `deck`: the deck there is, if any, which has no cards.
export async function showSetup(deck: Deck | undefined): Promise<void> {
  let settings = await loadSettings().catch(() => defaultSettings); // for your choices below
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
  const choicesOf = (form: HTMLFormElement) =>
    firstRunChoices(settings, checkedGameTypes(form), (form.elements.namedItem('recentGames') as HTMLInputElement).value);
  // Your choices are saved as you make them, so that they're still here after signing in, which
  // goes to Lichess's page and back.
  const choose = (e: Event): void => {
    if (!['gameTypes', 'recentGames'].includes((e.target as HTMLInputElement).name)) return;
    const chosen = choicesOf(e.currentTarget as HTMLFormElement);
    if ('settings' in chosen) {
      settings = chosen.settings;
      saveSettings(settings).catch(() => {}); // Start saves them again, and says if that fails
    }
  };
  // Saves your choices, for later updates too, then builds your deck.
  const start = async (e: SubmitEvent): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value.trim();
    if (update?.state === 'running' || !username) return;
    const chosen = choicesOf(form);
    problem = 'problem' in chosen ? chosen.problem : '';
    if ('problem' in chosen) return redraw();
    settings = chosen.settings;
    await saveSettings(settings);
    const gameTypes = settings.gameTypes;
    update = new DeckUpdateCtrl(username, () => gameTypes, redraw);
    await update.start();
    if (update.built && !update.built.cards.length) analyseHere(username, gameTypes);
  };

  const view = (): VNode => {
    const running = update?.state === 'running';
    const built = update ? update.built : deck;
    return hl('main.page-small.box.box-pad.mt-settings-page', [
      hl('h1.box__top', 'Mistake Trainer'),
      hl('p', [
        'Practise the mistakes from your own Lichess games, with spaced repetition. Each card is a position ' +
          'where you went wrong, to solve as in Lichess’s “Learn from your mistakes”. ',
        hl('a.mt-how', { on: { click: showHowItWorks } }, 'How it works'),
      ]),
      hl(
        'p',
        'To begin, the page downloads your games of the kinds you choose from Lichess, and finds your ' +
          'mistakes in the ones with computer analysis.',
      ),
      renderSignIn(async () => {
        await signOut();
        redraw();
      }),
      hl('form.mt-setup', { on: { submit: start, input: choose } }, [
        hl('div.mt-setup__row', ['Games: ', ...renderGameTypes(settings.gameTypes)]),
        hl('div.mt-setup__row', [
          hl('label', { attrs: { for: 'recentGames' } }, 'New cards from your last'),
          hl('input', {
            attrs: { id: 'recentGames', name: 'recentGames', type: 'number', min: 1, step: 1, value: settings.recentGames ?? '' },
          }),
          'games',
          hl('span.mt-setup__note', 'Leave it empty for all of them. You can change it later in Training settings.'),
        ]),
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
      // Only before there's a deck: a deck without cards has your account, and maybe analyses made here.
      !deck &&
        hl('p.mt-setup__import', [
          'Just looking? ',
          hl('a', { on: { click: trySample } }, 'Try a sample deck'),
          ', made from 20 of the author’s Lichess games.',
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
  deck.gameTimes.length
    ? `None of ${deck.username}’s ${deck.gameTimes.length} games with computer analysis has a mistake by them.`
    : `None of ${deck.username}’s games has computer analysis yet. Lichess analyses a game when you ask it ` +
      'to, on the game’s page, or you can analyse them here, below.';
