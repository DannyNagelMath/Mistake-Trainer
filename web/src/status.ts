// status.ts: how a game ended, in words, for the line under the move list. From lila's
// ui/lib/src/game/status.ts (the status ids) and ui/lib/src/game/view/status.ts (statusOf),
// master, commit 27ffc8b. Every change from lila's version is marked with a comment starting "Trim:".

import { opposite, type Color } from 'chessops';

import { i18n } from './i18n';

// The ids come from scalachess (core/src/main/scala/Status.scala). Every id from mate (30) up
// means the game is over; lila shows a result only then.
export const status: Record<string, number> = {
  created: 10,
  started: 20,
  aborted: 25,
  mate: 30,
  resign: 31,
  stalemate: 32,
  timeout: 33,
  draw: 34,
  outoftime: 35,
  cheat: 36,
  noStart: 37,
  unknownFinish: 38,
  insufficientMaterialClaim: 39,
  variantEnd: 60,
};

// Trim: lila's is in ui/lib/src/game/chess.ts. The color whose turn it is after `ply` half-moves.
const plyColor = (ply: number): Color => (ply % 2 === 0 ? 'white' : 'black');

// Trim: lila's StatusData also has abortedBy, fiftyMoves, threefold, drawOffers, source, and the
// variant. The API's game export has none of those, so draws by those rules just say "Draw".
export interface StatusData {
  winner?: Color;
  status: string;
  ply: number; // the number of half-moves in the game
}

export function statusOf(d: StatusData): string {
  const winnerSuffix = d.winner ? ` • ${i18n.site[`${d.winner}IsVictorious`]}` : '';
  switch (d.status) {
    // Trim: lila also handles 'started' and 'aborted'. We only load finished games.
    case 'mate':
      return i18n.site.checkmate + winnerSuffix;
    case 'resign':
      return i18n.site[`${opposite(d.winner ?? 'black')}Resigned`] + winnerSuffix;
    case 'stalemate':
      return i18n.site.stalemate + winnerSuffix;
    case 'timeout':
      return d.winner
        ? i18n.site[`${opposite(d.winner)}LeftTheGame`] + winnerSuffix
        : `${i18n.site[`${plyColor(d.ply)}LeftTheGame`]} • ${i18n.site.draw}`;
    case 'draw':
      return i18n.site.draw; // Trim: lila names the draw rule here, when it knows it.
    case 'insufficientMaterialClaim':
      return `${i18n.site.drawClaimed} • ${i18n.site.insufficientMaterial}`;
    case 'outoftime':
      return `${i18n.site[`${plyColor(d.ply)}RanOutOfTime`]}${winnerSuffix || ` • ${i18n.site.draw}`}`;
    case 'noStart':
      return i18n.site[`${opposite(d.winner ?? 'black')}DidntMove`] + winnerSuffix;
    case 'cheat':
      return i18n.site.cheatDetected + winnerSuffix;
    case 'variantEnd':
      return i18n.site.variantEnding + winnerSuffix; // Trim: lila names King of the Hill and Three-check endings.
    case 'unknownFinish':
      return d.winner ? i18n.site[`${d.winner}IsVictorious`] : i18n.site.finished;
    default:
      return d.status + winnerSuffix;
  }
}
