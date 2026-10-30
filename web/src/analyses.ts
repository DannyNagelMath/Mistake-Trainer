// analyses.ts: Not in lila. The analyses made on your computer (localAnalysis.ts), which storage.ts
// keeps, by game.

import type { LichessAnalysisEntry } from './tree';

export interface SavedAnalysis {
  analysis: LichessAnalysisEntry[]; // in the form of Lichess's game export
  engine: string; // e.g. "Stockfish 19"
  nodes: number; // the positions searched for each move
  at: string; // when it was made, as an ISO date
}
