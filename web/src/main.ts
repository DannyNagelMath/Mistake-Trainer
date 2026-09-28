import { Chessground } from '@lichess-org/chessground';
import type { Key } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';

import type { Color } from 'chessops';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';

import game from '../fixtures/real1.json';
import { AnalysisCtrl } from './analysisCtrl';

import type { LichessGameJson } from './tree';


// Hard-coded until "work out Dan's color from username" is done.
const MY_COLOR: Color = 'white';

const ctrl = new AnalysisCtrl(game as LichessGameJson, MY_COLOR);
ctrl.toggleRetro(); // makeRetro should jump to the first mistake

const node = ctrl.node; // the position BEFORE the mistake
console.log('ply', node.ply, 'path', ctrl.path, 'fen', node.fen, 'uci', node.uci);

const uciToMove = (uci?: string): Key[] | undefined =>
  uci ? [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] : undefined;

const inCheck = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap().isCheck();

Chessground(document.getElementById('board')!, {
  fen: node.fen,
  orientation: ctrl.bottomColor(),
  turnColor: node.ply % 2 === 0 ? 'white' : 'black',
  lastMove: uciToMove(node.uci),
  check: inCheck, // `true` tells Chessground to highlight the king of turnColor
  viewOnly: true, // step 3 makes it movable
});