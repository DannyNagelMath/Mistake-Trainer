// autoShape.ts: what the board draws by itself: arrows and annotations. From lila's
// ui/analyse/src/autoShape.ts (master, commit 27ffc8b), makeShapesFromUci and compute.
// Every change from lila's version is marked with a comment starting "Trim:".

import type { DrawModifiers, DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { parseFen } from 'chessops/fen';
import { makeSquare, parseUci } from 'chessops/util';

import type { AnalysisCtrl } from './analysisCtrl';
import { analysisGlyphs, annotationShapes } from './glyphs';

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
// engine's other lines and threats, and maneuver arrows.
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
  // Green: what the computer analysis says should have been played instead of the move that led here.
  // Blue: the best move from here: the engine's, or for the game's moves, the computer analysis's.
  // Trim: lila also checks the engine is allowed here (isCevalAllowed), and lets you have several
  // engine lines, with a paler arrow for each of the others.
  if (ctrl.showBestMoveArrows() && ctrl.showEvaluation()) {
    if (ctrl.node.eval?.best) shapes = shapes.concat(makeShapesFromUci(ctrl.node.eval.best, 'paleGreen'));
    const nextBest = ctrl.node.ceval?.pv?.[0] || ctrl.nextNodeBest();
    if (nextBest) shapes = shapes.concat(makeShapesFromUci(nextBest, 'paleBlue'));
  }
  if (ctrl.showMoveAnnotations()) shapes = shapes.concat(annotationShapes(ctrl.node));
  if (ctrl.showVariationArrows()) hiliteVariations(ctrl, shapes);

  // The board marks you can switch on (motif.ts), each in a corner of its square.
  if (ctrl.isCevalAllowed()) {
    const parsed = parseFen(ctrl.node.fen);
    if ('error' in parsed) return shapes;
    const { board, epSquare, castlingRights } = parsed.value;

    const addAnalysis = (orig: Key, type: keyof typeof analysisGlyphs) => {
      const idx = shapes.filter(s => s.orig === orig && s.customSvg).length;
      shapes.push({
        orig,
        customSvg: { html: analysisGlyphs[type](idx) },
      });
    };

    if (ctrl.motifEnabled()) {
      ctrl.motif.detectPins(board).forEach(p => addAnalysis(makeSquare(p.pinned), 'pin'));
      ctrl.motif
        .detectUndefended(board, epSquare)
        .forEach(u => addAnalysis(makeSquare(u.square), 'undefended'));
      ctrl.motif
        .detectCheckable(board, epSquare, castlingRights)
        .forEach(s => addAnalysis(makeSquare(s.king), 'checkable'));
    }
  }

  return shapes;
}

// From lila: where there's more than one move from here, an arrow for each, under the pieces, with
// the selected one (fork.ts: the up and down keys, or a tap of shift) outlined in blue. A move that
// already has an arrow, such as the best move, gets the outline on that arrow instead.
// Trim: lila colours them as right and wrong in the study editor, and adds the piece for a drop.
function hiliteVariations(ctrl: AnalysisCtrl, autoShapes: DrawShape[]) {
  const visible = ctrl.visibleChildren();
  if (visible.length < 2) return;

  for (const [i, node] of visible.entries()) {
    const existing = autoShapes.find(s => s.orig + s.dest === node.uci);
    // Not in lila: the arrow keeps its other modifiers, such as the width of "Show my move".
    if (existing) existing.modifiers = { ...existing.modifiers, hilite: i === ctrl.fork.selectedIndex ? 'white' : undefined };
    else {
      const hilite = i === ctrl.fork.selectedIndex ? '#3291ff' : '#aaa';
      const shapes = makeShapesFromUci(node.uci, 'variation', { hilite }).map(s => ({ ...s, below: true }));
      autoShapes.push(...shapes);
    }
  }
}
