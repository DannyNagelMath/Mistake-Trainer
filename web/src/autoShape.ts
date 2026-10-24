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
  // Step 3c: while you're solving, the move you played in the game as a pale red arrow, and only
  // that. Not in lila: off unless AnalysisCtrl.showBadMoveArrow is on.
  const badNode = ctrl.showBadMoveArrow ? ctrl.retro?.showBadNode() : undefined;
  if (badNode?.uci) return makeShapesFromUci(badNode.uci, 'paleRed', { lineWidth: 8 });
  // Green: what Lichess's analysis says should have been played instead of the move that led here.
  // Blue: the best move from here, for the game's moves, from Lichess's analysis.
  // Trim: lila also checks the engine is allowed here (isCevalAllowed). When its engine is on,
  // the engine's best move is the blue arrow, with paler ones for its other lines.
  if (ctrl.showBestMoveArrows() && ctrl.showEvaluation()) {
    if (ctrl.node.eval?.best) shapes = shapes.concat(makeShapesFromUci(ctrl.node.eval.best, 'paleGreen'));
    const nextBest = ctrl.nextNodeBest();
    if (nextBest) shapes = shapes.concat(makeShapesFromUci(nextBest, 'paleBlue'));
  }
  if (ctrl.showMoveAnnotations()) shapes = shapes.concat(annotationShapes(ctrl.node));
  return shapes;
}
