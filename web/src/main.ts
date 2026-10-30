// main.ts: the page's start. Back from Lichess's sign-in page, it finishes signing in
// (lichessAuth.ts). Then it shows the trainer (trainer.ts) with your deck, or, until there's one with
// cards, the first-run screen (setupView.ts), which builds it.
// Our own few styles are in mistakeTrainer.css, which Vite adds after lila's.

import './mistakeTrainer.css';

import { finishSignIn } from './lichessAuth';
import { showSetup } from './setupView';
import { loadDeck } from './storage';
import topBar from './topBar';
import { startTrainer } from './trainer';

// From lila's site script: the header, as the page scrolls.
topBar();

const signInProblem = await finishSignIn();
if (signInProblem) alert(signInProblem);

const deck = await loadDeck();
if (deck?.cards.length) await startTrainer(document.querySelector<HTMLElement>('main.analyse')!, deck);
else await showSetup(deck);
