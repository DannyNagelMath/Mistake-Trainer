// glyphs.ts: draws a move's annotations (??, ?!, ...) on the square it went to, from lila's
// ui/lib/src/game/glyphs.ts (master, commit 27ffc8b), only annotationShapes. The pictures come
// with chessground.

import type { DrawShape } from '@lichess-org/chessground/draw';
import * as cgGlyphs from '@lichess-org/chessground/glyph';
import { makeSquare, parseUci, squareRank } from 'chessops/util';

import type { TreeNode } from './tree';

// maximum number of glyphs to show for a given move
const maxGlyphs = 4;

export function annotationShapes(node: TreeNode): DrawShape[] {
  const { uci, glyphs, san } = node;
  if (uci && san && glyphs) {
    return (
      glyphs
        .slice(0, maxGlyphs)
        .map((glyph, idx: number) => {
          const move = parseUci(uci)!;
          const destSquare = san.startsWith('O-O') // castle, short or long
            ? squareRank(move.to) === 0 // white castle
              ? san.startsWith('O-O-O')
                ? 'c1'
                : 'g1'
              : san.startsWith('O-O-O')
                ? 'c8'
                : 'g8'
            : makeSquare(move.to);
          const symbol = glyph.symbol;
          const prerendered = glyphToSvg[symbol] ? glyphToSvg[symbol](idx) : undefined;
          return {
            orig: destSquare,
            brush: prerendered ? '' : undefined,
            customSvg: prerendered ? { html: prerendered } : undefined,
            label: prerendered ? undefined : { text: symbol, fill: 'purple' },
            // keep some purple just to keep feedback forum on their toes
          };
        })
        // needed so that the right-most (and first) glyph is at the top of the stack
        .reverse()
    );
  } else return [];
}

export const glyphToSvg: Record<string, (stackedNumber: number) => string> = cgGlyphs.glyphToSvg(maxGlyphs);
