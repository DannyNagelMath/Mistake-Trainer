// analyses.ts: Not in lila. The analyses made on your computer (localAnalysis.ts), which the dev
// server keeps in data/analysis.json, by game (vite.config.ts).

import type { LichessAnalysisEntry } from './tree';

export interface SavedAnalysis {
  analysis: LichessAnalysisEntry[]; // in the form of Lichess's game export
  engine: string; // e.g. "Stockfish 19"
  nodes: number; // the positions searched for each move
  at: string; // when it was made, as an ISO date
}

export async function loadAnalyses(): Promise<Record<string, SavedAnalysis>> {
  const response = await fetch('/api/analysis');
  // A dev server started before /api/analysis was added answers with the page itself.
  if (!response.ok || !response.headers.get('content-type')?.includes('json'))
    throw new Error(`Couldn't load the saved analyses (${response.status}). Restart the dev server (npm run dev).`);
  return response.json();
}

// Saves a game's analysis, replacing any saved before.
export async function saveAnalysis(gameId: string, saved: SavedAnalysis): Promise<void> {
  const response = await fetch('/api/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, ...saved }),
  });
  if (!response.ok) throw new Error(`Couldn't save the analysis of ${gameId}: ${response.status} ${await response.text()}`);
}
