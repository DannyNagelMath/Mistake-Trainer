// deck.ts: Step 9. The cards to review: one for each mistake you made in your saved games.
// A card is a mistake that lila's "Learn from your mistakes" would show you in that game,
// found the same way (retroCtrl's findNextNode), including lila's check against the masters
// database for opening mistakes (see inOpening). buildDeck below builds the deck from your games,
// with the analyses made here for the games Lichess hasn't analysed (withAnalysis); "Update deck"
// runs it (deckUpdate.ts), and storage.ts keeps the deck.

import type { Color } from 'chessops';
import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeUci, parseUci } from 'chessops/util';

import type { SavedAnalysis } from './analyses';
import type { Speed } from './gameDownload';
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
  // When each of your games with computer analysis started, newest first, mistakes or not, for
  // "Recent games" in Training settings. Decks built before October 29, 2026 don't have it.
  gameTimes?: number[];
}

// Deck.gameTimes, or for a deck built without it, when each of its games started, newest first:
// only the games with cards, as those are all it has.
export const gameTimesOf = (deck: Deck): number[] =>
  deck.gameTimes ?? Object.values(deck.games).map(g => g.createdAt ?? 0).sort((a, b) => b - a);

// Your color in the game, or undefined if you didn't play in it.
export function colorOf(game: LichessGameJson, username: string): Color | undefined {
  const id = username.toLowerCase();
  if (game.players?.white.user?.id === id) return 'white';
  if (game.players?.black.user?.id === id) return 'black';
  return undefined;
}

// The games you played, as the deck takes them (buildDeck below): standard chess, and each
// game once. Your downloaded games can have one twice: then the one with Lichess's analysis, if
// either has it.
export function yourGames(games: LichessGameJson[], username: string): LichessGameJson[] {
  const yours = new Map<string, LichessGameJson>();
  for (const game of games) {
    if (!colorOf(game, username) || (game.variant ?? 'standard') !== 'standard') continue;
    const kept = yours.get(game.id);
    if (!kept || (!kept.analysis && game.analysis)) yours.set(game.id, game);
  }
  return [...yours.values()];
}

// Not in lila: the game with the computer analysis its cards come from. Lichess's comes first; for
// a game Lichess hasn't analysed, the one made here, on your computer (localAnalysis.ts), if there
// is one, and the game says so (analysedHere). Undefined if there's neither.
export function withAnalysis(game: LichessGameJson, saved: SavedAnalysis | undefined): LichessGameJson | undefined {
  if (game.analysis) return game;
  if (!saved) return undefined;
  const { analysis, ...analysedHere } = saved;
  return { ...game, analysis, analysedHere };
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

// The masters database, for buildDeck: whether a position's answer is saved already, so that
// looking it up asks Lichess nothing, and the moves masters have played from the position.
export interface Masters {
  has(fen: string): boolean;
  moves(fen: string): Promise<MasterMove[]>;
}

// What buildDeck did, for reporting.
export interface DeckReport {
  skipped: Record<string, number>; // games left out: reason -> how many
  opening: number; // opening mistakes checked against the masters database
  bookMoves: number; // of those, left out as book moves
}

// A moment for the page to respond, between parts of a long job.
const pause = () => new Promise(resolve => setTimeout(resolve));

// Builds the deck from your downloaded games of the kinds you chose: a card for each of your
// mistakes, from Lichess's computer analysis, or for a game Lichess hasn't analysed, from the one
// made here (withAnalysis).
// Then lila's check of opening mistakes against the masters database (inOpening): a book move's
// card goes, and the others keep the masters' moves, which count as right answers. Asking about a
// new position takes a while, so `onAsk` hears how many there are, and then each one asked.
export async function buildDeck(
  downloaded: LichessGameJson[],
  analyses: Record<string, SavedAnalysis>,
  username: string,
  speeds: Speed[], // the kinds of games you chose (settings.ts gameTypes)
  masters: Masters,
  onAsk: (asked: number, toAsk: number) => void = () => {},
): Promise<{ deck: Deck; report: DeckReport }> {
  const deck: Deck = { username, builtAt: new Date().toISOString(), games: {}, cards: [] };
  const report: DeckReport = { skipped: {}, opening: 0, bookMoves: 0 };
  const skip = (reason: string) => (report.skipped[reason] = (report.skipped[reason] ?? 0) + 1);
  const gameTimes: number[] = [];

  // The standard games you played, each once: a game saved twice is taken with Lichess's analysis,
  // if either copy has it, so that Lichess's analysis always comes first (withAnalysis).
  const yours = yourGames(downloaded, username);
  if (downloaded.length > yours.length)
    report.skipped['not yours, not standard chess, or saved twice'] = downloaded.length - yours.length;
  const games = yours.filter(g => speeds.includes(g.speed as Speed));
  if (yours.length > games.length) report.skipped['not of the kinds you chose'] = yours.length - games.length;
  for (const [i, g] of games.entries()) {
    if (i % 20 === 19) await pause();
    const game = withAnalysis(g, analyses[g.id]);
    if (!game) {
      skip('no computer analysis');
      continue;
    }
    let cards: Card[];
    try {
      cards = cardsOfGame(game, colorOf(game, username)!);
    } catch (e) {
      skip(`couldn't read the moves (${(e as Error).message})`);
      continue;
    }
    gameTimes.push(game.createdAt ?? 0); // mistakes or not
    if (!cards.length) {
      skip('no mistakes');
      continue;
    }
    deck.games[game.id] = game;
    deck.cards.push(...cards);
  }

  const opening = deck.cards.filter(c => inOpening(deck.games[c.gameId], c));
  report.opening = opening.length;
  // Each position, worked out once: mistakeOf builds the game's whole tree.
  const mistakes = new Map<Card, { fen: string; uci: string }>();
  for (const [i, card] of opening.entries()) {
    if (i % 20 === 19) await pause();
    mistakes.set(card, mistakeOf(deck.games[card.gameId], card));
  }
  const toAsk = new Set([...mistakes.values()].map(m => m.fen).filter(fen => !masters.has(fen))).size;
  if (toAsk) onAsk(0, toAsk);
  let asked = 0;
  for (const card of opening) {
    const mistake = mistakes.get(card)!;
    const isNew = !masters.has(mistake.fen);
    const checked = withMasterMoves(card, mistake, await masters.moves(mistake.fen));
    if (isNew) onAsk(++asked, toAsk);
    if (!checked) report.bookMoves++;
    deck.cards.splice(deck.cards.indexOf(card), 1, ...(checked ? [checked] : []));
  }
  // The deck only keeps games that still have a card.
  for (const id of Object.keys(deck.games)) if (!deck.cards.some(c => c.gameId === id)) delete deck.games[id];
  deck.gameTimes = gameTimes.sort((a, b) => b - a); // newest first
  return { deck, report };
}
