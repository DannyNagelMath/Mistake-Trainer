// deck.ts: Not in lila. The cards: one for each mistake in your games that lila's "Learn from your
// mistakes" would show you, found the same way (retroCtrl's findNextNode). buildDeck builds the
// deck, from your games and their analyses; "Update deck" runs it (deckUpdate.ts).

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
  // "Recent games" in Training settings.
  gameTimes: number[];
}

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

// The game with the computer analysis its cards come from. Lichess's comes first; for
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

// The masters' moves, written as chessops writes moves, as yours is (see mistakeOf):
// castling as the king taking its own rook (e1h1), where the masters database may write it the
// usual way (e1g1). Otherwise castling would never match. For withMasterMoves, and for the trainer,
// which asks about a position when its card comes up (deckCtrl.ts).
export function withChessopsCastling(fen: string, moves: MasterMove[]): MasterMove[] {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  return moves.map(m => {
    const move = parseUci(m.uci);
    return move ? { ...m, uci: makeUci(normalizeMove(pos, move)) } : m;
  });
}

// lila's rule (retroCtrl's jumpToNext), with the moves masters have played from the position:
// a move played in more than one master game is a book move, not a mistake. So if your move is
// one, the card goes (undefined); otherwise it keeps the book moves, which count as right answers.
export function withMasterMoves(card: Card, mistake: { fen: string; uci: string }, moves: MasterMove[]): Card | undefined {
  const book = withChessopsCastling(mistake.fen, moves)
    .filter(m => m.white + m.draws + m.black > 1)
    .map(m => m.uci);
  if (book.includes(mistake.uci)) return undefined;
  return book.length ? { ...card, masterMoves: book } : card;
}

// A moment for the page to respond, between parts of a long job.
const pause = () => new Promise(resolve => setTimeout(resolve));

// Builds the deck from your downloaded games of the kinds you chose: a card for each of your
// mistakes (withAnalysis says from whose analysis). Then lila's check of opening mistakes against
// the masters database (inOpening), with the answers saved so far: a book move's card goes. A
// position not asked about yet is asked about when its card comes up (retroCtrl's jumpToNext).
export async function buildDeck(
  downloaded: LichessGameJson[],
  analyses: Record<string, SavedAnalysis>,
  username: string,
  speeds: Speed[], // the kinds of games you chose (settings.ts gameTypes)
  answers: Record<string, MasterMove[]>, // the masters database's, saved so far, by position
): Promise<Deck> {
  const deck: Deck = { username, builtAt: new Date().toISOString(), games: {}, cards: [], gameTimes: [] };
  const games = yourGames(downloaded, username).filter(g => speeds.includes(g.speed as Speed));
  for (const [i, g] of games.entries()) {
    if (i % 20 === 19) await pause();
    const game = withAnalysis(g, analyses[g.id]);
    if (!game) continue;
    let cards: Card[];
    try {
      cards = cardsOfGame(game, colorOf(game, username)!);
    } catch {
      continue; // moves it couldn't read
    }
    deck.gameTimes.push(game.createdAt ?? 0); // mistakes or not
    if (!cards.length) continue;
    deck.games[game.id] = game;
    deck.cards.push(...cards);
  }

  const opening = deck.cards.filter(c => inOpening(deck.games[c.gameId], c));
  for (const [i, card] of opening.entries()) {
    if (i % 20 === 19) await pause();
    const mistake = mistakeOf(deck.games[card.gameId], card); // builds the game's whole tree
    const saved = answers[mistake.fen];
    if (!saved) continue;
    const checked = withMasterMoves(card, mistake, saved);
    deck.cards.splice(deck.cards.indexOf(card), 1, ...(checked ? [checked] : []));
  }
  // The deck only keeps games that still have a card.
  for (const id of Object.keys(deck.games)) if (!deck.cards.some(c => c.gameId === id)) delete deck.games[id];
  deck.gameTimes.sort((a, b) => b - a); // newest first
  return deck;
}
