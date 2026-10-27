// deck.ts: Step 9. The cards to review: one for each mistake you made in your saved games.
// A card is a mistake that lila's "Learn from your mistakes" would show you in that game,
// found the same way (retroCtrl's findNextNode), including lila's check against the masters
// database for opening mistakes (see inOpening). scripts/buildDeck.ts builds the deck from
// games.ndjson and saves it as public/data/deck.json, which the page loads.

import type { Color } from 'chessops';
import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeUci, parseUci } from 'chessops/util';

import { evalSwings } from './nodeFinder';
import { buildTree, mainline, type LichessGameJson } from './tree';
import { povChances } from './winningChances';

export interface Card {
  id: string; // `${gameId}/${ply}`, the same every time the deck is rebuilt, so review history can refer to it
  gameId: string;
  ply: number; // the mistake: the ply of the move you played
  color: Color; // your color in that game
  // For choosing which new cards come first (orderNewCards in schedule.ts). Your winning chances
  // before and after your move, from -1 (lost) to 1 (won), worked out from the evals as lila does.
  chancesBefore: number;
  chancesAfter: number;
  moveNumber: number;
  playedAt: number; // when the game started, in milliseconds since 1970
  // For a mistake in the opening (inOpening): the moves masters have played from the position,
  // in UCI, which count as right answers too, as in lila. Missing if there are none.
  masterMoves?: string[];
}

// A move from the masters database, and how many master games it was played in.
export interface MasterMove {
  uci: string;
  white: number; // games White won
  draws: number;
  black: number; // games Black won
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
  const line = mainline(buildTree(game));
  const rounded = (x: number) => Math.round(x * 1000) / 1000; // keeps deck.json small
  return evalSwings(line, n => n.ply % 2 === colorModulo).map(n => {
    const before = line[line.indexOf(n) - 1]; // evalSwings only picks moves with evals before and after
    return {
      id: `${game.id}/${n.ply}`,
      gameId: game.id,
      ply: n.ply,
      color,
      chancesBefore: rounded(povChances(color, before.eval!)),
      chancesAfter: rounded(povChances(color, n.eval!)),
      moveNumber: Math.ceil(n.ply / 2),
      playedAt: game.createdAt ?? 0,
    };
  });
}

// Whether lila checks the mistake against the masters database (retroCtrl's jumpToNext): a
// standard game whose analysis says where the middlegame starts, and a mistake before that, or
// anywhere if the game never reached a middlegame.
export const inOpening = (game: LichessGameJson, card: Card): boolean =>
  (game.variant ?? 'standard') === 'standard' &&
  !!game.division &&
  (!game.division.middle || card.ply < game.division.middle);

// The position before your mistake, as a FEN, and the move you played there, in UCI.
export function mistakeOf(game: LichessGameJson, card: Card): { fen: string; uci: string } {
  const line = mainline(buildTree(game));
  const played = line.find(n => n.ply === card.ply)!;
  return { fen: line[line.indexOf(played) - 1].fen, uci: played.uci! };
}

// lila's rule (retroCtrl's jumpToNext), with the moves masters have played from the position:
// a move played in more than one master game is a book move, not a mistake. So if your move is
// one, the card goes (undefined); otherwise it keeps the book moves, which count as right answers.
// Not in lila: the masters' moves are first written as chessops writes moves, as yours is (see
// mistakeOf): castling as the king taking its own rook (e1h1), where the masters database may write
// it the usual way (e1g1). Otherwise castling would never match.
export function withMasterMoves(card: Card, mistake: { fen: string; uci: string }, moves: MasterMove[]): Card | undefined {
  const pos = Chess.fromSetup(parseFen(mistake.fen).unwrap()).unwrap();
  const book = moves
    .filter(m => m.white + m.draws + m.black > 1)
    .map(m => {
      const move = parseUci(m.uci);
      return move ? makeUci(normalizeMove(pos, move)) : m.uci;
    });
  if (book.includes(mistake.uci)) return undefined;
  return book.length ? { ...card, masterMoves: book } : card;
}

// Loads the games you've downloaded (../pipeline/data/games.ndjson), or the masters database's
// answers saved when the deck was built (../pipeline/data/masters.json, by FEN), from the dev
// server (vite.config.ts).
export const loadGames = (): Promise<LichessGameJson[]> => loadData('/api/games', 'your downloaded games');
export const loadMasters = (): Promise<Record<string, MasterMove[]>> =>
  loadData('/api/masters', "the masters database's saved answers");

async function loadData<T>(url: string, what: string): Promise<T> {
  const response = await fetch(url);
  // A dev server started before these addresses were added answers with the page itself.
  if (!response.ok || !response.headers.get('content-type')?.includes('json'))
    throw new Error(`Couldn't load ${what} (${response.status}). Restart the dev server (npm run dev).`);
  return response.json();
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
