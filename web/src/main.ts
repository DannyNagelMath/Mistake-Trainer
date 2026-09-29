// Step 4b: the board's CSS now comes from lila's stylesheets, loaded in index.html.

import type { Color } from 'chessops';
import { init, attributesModule, classModule, eventListenersModule, propsModule } from 'snabbdom';

import game from '../fixtures/real1.json';
import { AnalysisCtrl } from './analysisCtrl';
import type { LichessGameJson } from './tree';
import { view } from './view';

// Hard-coded until "work out Dan's color from username" is done.
const MY_COLOR: Color = 'white';

// Step 4a: the same snabbdom setup as lila's (ui/analyse/src/view/util.ts).
const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

// Step 4a: like lila's start.ts. Render into the page's <main class="analyse">, then re-render
// the whole view on every redraw. snabbdom compares the new view with the old one and only
// touches the parts of the page that changed.
const element = document.querySelector('main.analyse') as HTMLElement;
const ctrl = new AnalysisCtrl(game as LichessGameJson, MY_COLOR, redraw);
let vnode = patch(element, view(ctrl)); // the board is created here, by renderGround's insert hook

// A function declaration rather than an arrow function, so it already exists when the
// constructor above receives it.
function redraw(): void {
  // console.count('redraw'); // temporary, for the step 4a check
  vnode = patch(vnode, view(ctrl));
}

ctrl.toggleRetro();

(window as any).ctrl = ctrl; // for testing from the browser console; remove later