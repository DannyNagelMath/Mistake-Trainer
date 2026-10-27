// compareMain.ts: Not in lila. Starts the comparison page (compare.html; see compare.ts). The
// trainer doesn't link to it: open /compare.html while the dev server runs. It's a page of its own
// so that a long run leaves the trainer alone; best not to train meanwhile, as both would share
// your computer's time.

import './mistakeTrainer.css';
import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import { loadAnalyses } from './analyses';
import { CompareCtrl } from './compare';
import { view } from './compareView';
import { loadDeck, loadGames, loadMasters, yourGames } from './deck';

const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);
let vnode: VNode | Element = document.querySelector('main.mt-compare-page')!;

const fail = (message: string): never => {
  (vnode as Element).textContent = message;
  throw new Error(message);
};
const [deck, games, masters, saved] = await Promise.all([loadDeck(), loadGames(), loadMasters(), loadAnalyses()]).catch(
  (e: Error) => fail(e.message),
);
if (!deck) fail('No deck yet. Build one from web with: npx tsx scripts/buildDeck.ts <your Lichess username>');
const { username } = deck!;

// The games you played that Lichess has analysed.
const analysed = yourGames(games, username).filter(g => g.analysis);

const ctrl = new CompareCtrl(username, analysed, saved, masters, redraw);

function redraw(): void {
  vnode = patch(vnode, view(ctrl));
}
redraw();
