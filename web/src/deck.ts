// deck.ts: Step 9. The cards to review: one for each mistake you made in your saved games.
// A card is a mistake that lila's "Learn from your mistakes" would show you in that game,
// found the same way (retroCtrl's findNextNode). scripts/buildDeck.ts builds the deck from
// games.ndjson and saves it as public/data/deck.json, which the page loads.

import type { Color } from 'chessops';

import { evalSwings } from './nodeFinder';
import { buildTree, mainline, type LichessGameJson } from './tree';

export interface Card {
  id: string; // `${gameId}/${ply}`, the same every time the deck is rebuilt, so review history can refer to it
  gameId: string;
  ply: number; // the mistake: the ply of the move you played
  color: Color; // your color in that game
}

export interface Deck {
  username: string;
  builtAt: string; // when the deck was built, as an ISO date
  games: Record<string, LichessGameJson>; // by game id; only games with at least one card
  cards: Card[];
}

// Your color in the game, or undefined if you didn't play in it.
export function colorOf(game: LichessGameJson, username: string): Color | undefined {
  const id = username.toLowerCase();
  if (game.players?.white.user?.id === id) return 'white';
  if (game.players?.black.user?.id === id) return 'black';
  return undefined;
}

// Your mistakes in one game, in order. Like retroCtrl's findNextNode: every move of your color
// where the eval swung by more than 10% winning chances, and the analysis has a better move.
// The game needs analysis and must be standard chess (buildTree only knows standard chess).
export function cardsOfGame(game: LichessGameJson, color: Color): Card[] {
  const colorModulo = color === 'white' ? 1 : 0;
  return evalSwings(mainline(buildTree(game)), n => n.ply % 2 === colorModulo).map(n => ({
    id: `${game.id}/${n.ply}`,
    gameId: game.id,
    ply: n.ply,
    color,
  }));
}

// Loads the deck the page uses. Undefined if it hasn't been built yet.
export async function loadDeck(url = '/data/deck.json'): Promise<Deck | undefined> {
  const response = await fetch(url);
  // Vite's dev server answers a missing file with the page itself (index.html), not a 404.
  const isJson = response.headers.get('content-type')?.includes('json');
  if (response.status === 404 || (response.ok && !isJson)) return undefined;
  if (!response.ok) throw new Error(`Couldn't load ${url}: ${response.status}`);
  return response.json();
}
