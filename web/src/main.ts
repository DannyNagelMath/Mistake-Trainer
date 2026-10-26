// Step 4b: the board's CSS comes from lila's stylesheets, loaded in index.html.
// Our own few styles are in mistakeTrainer.css, which Vite adds after lila's.
// Step 9: the page reviews the cards in public/data/deck.json (built by scripts/buildDeck.ts),
// rather than one fixture game, and keeps your review history in data/reviews.json. Your
// settings, from Training settings (settingsPage.ts), which shows in this page too, are in
// data/settings.json.

import './mistakeTrainer.css';
import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import { blurIfPrimaryClick } from './common';
import { loadDeck } from './deck';
import { DeckCtrl } from './deckCtrl';
import { preload } from './engine';
import * as keyboard from './keyboard';
import { loadHistory } from './reviews';
import { loadSettings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view as settingsView } from './settingsPageView';
import { hl } from './snabbdom';
import { view } from './view';

// Step 4a: the same snabbdom setup as lila's (ui/analyse/src/view/util.ts).
const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

const element = document.querySelector('main.analyse') as HTMLElement;

// Step 9: without a deck (or with an empty one), say how to build it instead.
const deck = await loadDeck();
if (!deck?.cards.length) {
  element.textContent = deck
    ? `The deck has no cards: none of the games in it have mistakes by ${deck.username}.`
    : 'No deck yet. Build one from web with: npx tsx scripts/buildDeck.ts <your Lichess username>';
  throw new Error('No cards to review');
}
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
    // The board's Settings dialog, if it's open, would keep you from using the rest of the page.
    if (deckCtrl.analysis.settingsOpen) deckCtrl.analysis.closeSettings();
    settingsCtrl = new SettingsPageCtrl(deckCtrl.deck, history, deckCtrl.settings, redraw, deckCtrl.useSettings);
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

// For testing from the browser console; remove later.
(window as any).ctrl = deckCtrl.analysis;
(window as any).deck = deckCtrl;
