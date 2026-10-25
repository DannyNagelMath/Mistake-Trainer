// autoShape.ts: what the board draws by itself: arrows and annotations. From lila's
// ui/analyse/src/autoShape.ts (master, commit 27ffc8b), makeShapesFromUci and compute.
// Every change from lila's version is marked with a comment starting "Trim:".

import type { DrawModifiers, DrawShape } from '@lichess-org/chessground/draw';
import { makeSquare, parseUci } from 'chessops/util';

import type { AnalysisCtrl } from './analysisCtrl';
import { annotationShapes } from './glyphs';

// An arrow for a move.
// Trim: lila also draws drops and promotions (the piece on the square), for which it needs the
// color of the side moving.
export function makeShapesFromUci(uci: string | undefined, brush: string, modifiers?: DrawModifiers): DrawShape[] {
  if (!uci) return [];
  const move = parseUci(uci);
  if (!move || !('from' in move)) return [];
  return [{ orig: makeSquare(move.from), dest: makeSquare(move.to), brush, modifiers }];
}

// Trim: lila also draws icons for how the game ended, arrows for the opening explorer, the
// engine's other lines, threats, and variations, and the engine's analysis glyphs.
export function compute(ctrl: AnalysisCtrl): DrawShape[] {
  let shapes: DrawShape[] = [];
  // Step 3c: the move you played in the game, as lila's pale red arrow. While you're solving, it's
  // the only arrow (lila's showBadNode). Not in lila: only when you ask for it ("Show my move"),
  // and once the card is done, also whenever you're back at its position, beside the others.
  if (ctrl.showBadMoveArrow()) {
    const badNode = ctrl.retro?.showBadNode();
    if (badNode?.uci) return makeShapesFromUci(badNode.uci, 'paleRed', { lineWidth: 8 });
    const cur = ctrl.card && ctrl.retro?.current();
    if (cur && ctrl.path === cur.prev.path)
      shapes = shapes.concat(makeShapesFromUci(cur.fault.node.uci, 'paleRed', { lineWidth: 8 }));
  }
  // Green: what Lichess's analysis says should have been played instead of the move that led here.
  // Blue: the best move from here: the engine's, or for the game's moves, Lichess's analysis's.
  // Trim: lila also checks the engine is allowed here (isCevalAllowed), and lets you have several
  // engine lines, with a paler arrow for each of the others.
  if (ctrl.showBestMoveArrows() && ctrl.showEvaluation()) {
    if (ctrl.node.eval?.best) shapes = shapes.concat(makeShapesFromUci(ctrl.node.eval.best, 'paleGreen'));
    const nextBest = ctrl.node.ceval?.pv?.[0] || ctrl.nextNodeBest();
    if (nextBest) shapes = shapes.concat(makeShapesFromUci(nextBest, 'paleBlue'));
  }
  if (ctrl.showMoveAnnotations()) shapes = shapes.concat(annotationShapes(ctrl.node));
  return shapes;
}
