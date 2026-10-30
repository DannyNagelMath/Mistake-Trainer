// trainer.ts: the trainer, once there's a deck: the analysis board with the card's game, the
// "Learn from your mistakes" panel in card mode (deckCtrl.ts), and Training settings, which shows in
// the same page (settingsPage.ts). main.ts starts it.
// Step 4b: the board's CSS comes from lila's stylesheets, loaded in index.html.
// Step 9: your review history is in data/reviews.json, and your settings in data/settings.json.

import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import { blurIfPrimaryClick } from './common';
import type { Deck } from './deck';
import { DeckCtrl } from './deckCtrl';
import { DeckUpdateCtrl } from './deckUpdate';
import { onSearching, preload } from './engine';
import { holdEngines, releaseEngines } from './fishnet';
import * as keyboard from './keyboard';
import { loadHistory } from './reviews';
import { loadSettings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view as settingsView } from './settingsPageView';
import { hl } from './snabbdom';
import { view } from './view';
import { YourGamesCtrl } from './yourGames';

// Step 4a: the same snabbdom setup as lila's (ui/analyse/src/view/util.ts).
const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

// Shows the trainer in `element` (the page's <main class="analyse">), with the deck's cards.
export async function startTrainer(element: HTMLElement, deck: Deck): Promise<void> {
  const [history, settings] = await Promise.all([loadHistory(), loadSettings()]).catch((e: Error) => {
    element.textContent = e.message;
    throw e;
  });

  // Step 4a: like lila's start.ts. Render into the page's <main class="analyse">, then re-render
  // the whole view on every redraw. snabbdom compares the new view with the old one and only
  // touches the parts of the page that changed.
  const deckCtrl = new DeckCtrl(deck, history, settings, redraw);
  let vnode = patch(element, view(deckCtrl.analysis, deckCtrl)); // the board is created here, by renderGround's insert hook

  // Not in lila: Training settings, while it shows, in its own <main> (index.html; see route below).
  let settingsCtrl: SettingsPageCtrl | undefined;
  let settingsVnode: VNode | Element = document.querySelector('main.mt-settings-page')!;

  // A function declaration rather than an arrow function, so it already exists when the
  // constructor above receives it. It draws whichever shows: the trainer, or Training settings.
  function redraw(): void {
    if (settingsCtrl) settingsVnode = patch(settingsVnode, settingsView(settingsCtrl));
    else vnode = patch(vnode, view(deckCtrl.analysis, deckCtrl));
  }

  // Step 5: redraw to show the panel, as lila's "Learn from your mistakes" button does
  // (bind('click', ctrl.toggleRetro, ctrl.redraw)). The redraw that retroCtrl does while it starts
  // up is too early: toggleRetro hasn't stored it in ctrl.retro yet.
  // Step 9: in card mode, it opens at the first card's mistake.
  deckCtrl.analysis.toggleRetro();
  redraw();

  // Step 7: keyboard shortcuts. lila binds them in AnalyseCtrl's constructor; here they're bound
  // in the page only, so the headless scripts, which have no page, can still create an AnalysisCtrl.
  const keys = keyboard.bind(deckCtrl.analysis);

  // Not in lila: load Stockfish in the background now, rather than when it's first needed.
  preload();

  // Not in lila: the computer analysis of your games, from Training settings, which goes on while you
  // train. The trainer's engine comes first: while it searches, the engines analysing your games
  // wait (fishnet.ts holdEngines).
  const yourGames = new YourGamesCtrl(deck.username, () => deckCtrl.settings.gameTypes, redraw);
  onSearching(searching => (searching ? holdEngines() : releaseEngines()));

  // Not in lila: "Update deck", in Training settings, which goes on while you train too.
  const deckUpdate = new DeckUpdateCtrl(deck.username, () => deckCtrl.settings.gameTypes, redraw);

  // Not in lila: a card you'd got right but not yet rated when you left comes back as you left it.
  deckCtrl.resume();

  // Not in lila: Training settings shows in this page rather than on one of its own, so going there
  // and back changes nothing in the trainer, which is only hidden meanwhile (mistakeTrainer.css):
  // the same card, as you left it, in the same place in the game. The address says which shows
  // (#settings for Training settings), so the browser's Back and Forward buttons go between them.
  // Each time Training settings opens, it starts afresh from your saved settings, as a page would.
  const link = document.querySelector<HTMLAnchorElement>('.site-buttons a')!;
  link.addEventListener('click', blurIfPrimaryClick); // as on lila's buttons: no focus box once you press a key
  let trainerScroll = 0; // how far down the trainer was scrolled, on a small screen
  function route(): void {
    const showSettings = location.hash === '#settings';
    if (showSettings === !!settingsCtrl) return;
    if (showSettings) {
      trainerScroll = window.scrollY;
      // The board's Settings dialog, or Your stats, if open, would keep you from using the rest of the page.
      if (deckCtrl.analysis.settingsOpen) deckCtrl.analysis.closeSettings();
      if (deckCtrl.statsOpen) deckCtrl.closeStats();
      settingsCtrl = new SettingsPageCtrl(
        deckCtrl.deck,
        history,
        deckCtrl.settings,
        redraw,
        deckCtrl.useSettings,
        yourGames,
        deckUpdate,
      );
      yourGames.load(); // the first time
    } else {
      settingsCtrl = undefined;
      settingsVnode = patch(settingsVnode, hl('main.page-small.box.box-pad.mt-settings-page')); // emptied until next time
    }
    document.body.classList.toggle('mt-settings-shown', showSettings);
    document.title = showSettings ? 'Training settings · Mistake Trainer' : 'Mistake Trainer';
    link.textContent = showSettings ? 'Back to training' : 'Training settings';
    link.href = showSettings ? '#' : '#settings';
    keys.paused = showSettings; // the trainer's shortcuts
    redraw();
    window.scrollTo(0, showSettings ? 0 : trainerScroll);
  }
  window.addEventListener('hashchange', route);
  route(); // e.g. after reloading Training settings

  // For trying things from the browser console while developing (npm run dev), not in a build.
  if (import.meta.env.DEV) Object.assign(window, { ctrl: deckCtrl.analysis, deck: deckCtrl });
}
