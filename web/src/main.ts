import { Chessground } from '@lichess-org/chessground';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';

import type { Color } from 'chessops';

import game from '../fixtures/real1.json';
import { AnalysisCtrl } from './analysisCtrl';
import type { LichessGameJson } from './tree';

// Hard-coded until "work out Dan's color from username" is done.
const MY_COLOR: Color = 'white';

const ctrl = new AnalysisCtrl(game as LichessGameJson, MY_COLOR);

const config = ctrl.cgConfig();
ctrl.cg = Chessground(document.getElementById('board')!, {
  ...config,
  movable: { ...config.movable, free: false, events: { after: ctrl.userMove } },
});
ctrl.toggleRetro();

(window as any).ctrl = ctrl; // for testing from the browser console; remove later