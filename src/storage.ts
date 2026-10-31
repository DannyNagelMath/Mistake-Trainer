// storage.ts: Not in lila. Where your data is kept, and the functions that load and save it. Running
// the app yourself (npm run dev), the dev server keeps it in files in data (vite.config.ts); on
// the website, which has no server of its own, the browser keeps it (browserStorage.ts). A build
// (npm run build) is for the website; VITE_STORAGE=browser npm run dev tries that with the dev server.
// Export and Import (backup.ts) move all of it to a file and back, in either.

import type { CardInput } from 'ts-fsrs';

import type { SavedAnalysis } from './analyses';
import { browserStorage } from './browserStorage';
import type { Deck, MasterMove } from './deck';
import type { ReviewEntry, ReviewHistory } from './reviews';
import { parseSettings, type Settings } from './settings';
import type { LichessGameJson } from './tree';

// Everything kept, as Export saves it (backup.ts).
export interface AllData {
  reviews: ReviewHistory;
  settings: Settings;
  analyses: Record<string, SavedAnalysis>; // the analyses made here, by game
  games: LichessGameJson[]; // your downloaded games
  masters: Record<string, MasterMove[]>; // the masters database's answers, by position
  deck: Deck | null; // null until the first is built
}

export interface Storage {
  loadHistory(): Promise<ReviewHistory>;
  saveReview(card: CardInput, entry: ReviewEntry): Promise<void>; // the card's new schedule, and the log entry
  saveSuspension(cardId: string, at: string): Promise<void>; // the card won't come up again
  saveUnsuspension(cardId: string): Promise<void>; // from Training settings: it can come up again
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  loadAnalyses(): Promise<AllData['analyses']>;
  saveAnalysis(gameId: string, saved: SavedAnalysis): Promise<void>; // replacing any saved before
  loadGames(): Promise<LichessGameJson[]>;
  saveGames(games: LichessGameJson[]): Promise<void>; // adding those it doesn't have yet
  loadMasters(): Promise<AllData['masters']>;
  saveMasterMoves(fen: string, moves: MasterMove[]): Promise<void>;
  loadDeck(): Promise<Deck | undefined>; // undefined until the first is built
  saveDeck(deck: Deck): Promise<void>;
  replaceAll(data: AllData): Promise<void>; // Import: everything, replaced with the file's
}

// ---------- The dev server's files (vite.config.ts) ----------

async function get<T>(url: string, what: string): Promise<T> {
  const response = await fetch(url);
  // A dev server started before an address was added answers with the page itself.
  if (!response.ok || !response.headers.get('content-type')?.includes('json'))
    throw new Error(`Couldn't load ${what} (${response.status}). Restart the dev server (npm run dev).`);
  return response.json();
}

// keepalive lets a request finish even if you leave the page straight after.
async function post(url: string, body: unknown, what: string, keepalive = false): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  });
  if (!response.ok) throw new Error(`Couldn't save ${what}: ${response.status} ${await response.text()}`);
}

const serverStorage: Storage = {
  loadHistory: () => get('/api/reviews', 'your review history'),
  saveReview: (card, entry) => post('/api/reviews', { card, entry }, 'your review', true),
  saveSuspension: (cardId, at) => post('/api/reviews', { suspend: cardId, at }, 'the suspension'),
  saveUnsuspension: cardId => post('/api/reviews', { unsuspend: cardId }, 'the unsuspension'),
  loadSettings: async () => parseSettings(await get('/api/settings', 'your settings')),
  saveSettings: s => post('/api/settings', s, 'your settings'),
  loadAnalyses: () => get('/api/analysis', 'the saved analyses'),
  saveAnalysis: (gameId, saved) => post('/api/analysis', { gameId, ...saved }, `the analysis of ${gameId}`),
  loadGames: () => get('/api/games', 'your downloaded games'),
  saveGames: games => post('/api/games', { games }, 'your games'),
  loadMasters: () => get('/api/masters', "the masters database's saved answers"),
  saveMasterMoves: (fen, moves) => post('/api/masters', { fen, moves }, "the masters' moves"),
  loadDeck: async () => (await get<Deck | null>('/api/deck', 'your deck')) ?? undefined,
  saveDeck: deck => post('/api/deck', deck, 'your deck'),
  replaceAll: data => post('/api/import', data, 'the imported data'),
};

// ---------- Which one ----------

export const inBrowser: boolean = import.meta.env.VITE_STORAGE === 'browser' || !import.meta.env.DEV;

export const {
  loadHistory,
  saveReview,
  saveSuspension,
  saveUnsuspension,
  loadSettings,
  saveSettings,
  loadAnalyses,
  saveAnalysis,
  loadGames,
  saveGames,
  loadMasters,
  saveMasterMoves,
  loadDeck,
  saveDeck,
  replaceAll,
}: Storage = inBrowser ? browserStorage : serverStorage;
