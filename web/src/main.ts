// Step 4b: the board's CSS comes from lila's stylesheets, loaded in index.html.
// Our own few styles are in mistakeTrainer.css, which Vite adds after lila's.
// Step 9: the page reviews the cards in public/data/deck.json (built by scripts/buildDeck.ts),
// rather than one fixture game, and keeps your review history in data/reviews.json.

import './mistakeTrainer.css';
import { init, attributesModule, classModule, eventListenersModule, propsModule } from 'snabbdom';

import { loadDeck } from './deck';
import { DeckCtrl } from './deckCtrl';
import * as keyboard from './keyboard';
import { loadHistory } from './reviews';
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
const history = await loadHistory().catch((e: Error) => {
  element.textContent = e.message;
  throw e;
});

// Step 4a: like lila's start.ts. Render into the page's <main class="analyse">, then re-render
// the whole view on every redraw. snabbdom compares the new view with the old one and only
// touches the parts of the page that changed.
const deckCtrl = new DeckCtrl(deck, history, redraw);
let vnode = patch(element, view(deckCtrl.analysis, deckCtrl)); // the board is created here, by renderGround's insert hook

// A function declaration rather than an arrow function, so it already exists when the
// constructor above receives it.
function redraw(): void {
  vnode = patch(vnode, view(deckCtrl.analysis, deckCtrl));
}

// Step 5: redraw to show the panel, as lila's "Learn from your mistakes" button does
// (bind('click', ctrl.toggleRetro, ctrl.redraw)). The redraw that retroCtrl does while it starts
// up is too early: toggleRetro hasn't stored it in ctrl.retro yet.
// Step 9: in card mode, it opens at the first card's mistake.
deckCtrl.analysis.toggleRetro();
redraw();

// Step 7: keyboard shortcuts. lila binds them in AnalyseCtrl's constructor; here they're bound
// in the page only, so the headless scripts, which have no page, can still create an AnalysisCtrl.
keyboard.bind(deckCtrl.analysis);

// For testing from the browser console; remove later.
(window as any).ctrl = deckCtrl.analysis;
(window as any).deck = deckCtrl;
