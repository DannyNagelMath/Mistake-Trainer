// deck.test.ts: Step 9. Checks that the deck finds the same mistakes as "Learn from your mistakes".
// The expected plies are the mistakes retroCtrl quizzes in these games.
import { expect, test } from 'vitest';

import real1 from '../fixtures/real1.json';
import real2 from '../fixtures/real2.json';
import real3 from '../fixtures/real3.json';
import { buildDeck, cardsOfGame, colorOf, gameTimesOf, inOpening, mistakeOf, withAnalysis, withMasterMoves, yourGames, type MasterMove } from './deck';
import type { LichessGameJson } from './tree';

const fixtures: Record<string, unknown> = { real1, real2, real3 };
const fixture = (name: string): LichessGameJson => fixtures[name] as LichessGameJson;

test('colorOf finds your color from your username, in any case', () => {
  const game = fixture('real1');
  expect(colorOf(game, 'mugglesman1982')).toBe('white');
  expect(colorOf(game, 'MugglesMan1982')).toBe('white');
  expect(colorOf(game, 'RealAgentCooper')).toBe('black');
  expect(colorOf(game, 'someone-else')).toBeUndefined();
});

test('yourGames: the standard games you played, each once, the one with Lichess’s analysis if either has it', () => {
  const game = fixture('real1'); // you played White
  const unanalysed = { ...game, analysis: undefined };
  const games = [
    unanalysed, // downloaded twice: first without Lichess's analysis...
    { ...game, id: 'variant', variant: 'chess960' },
    { ...game, id: 'notYours', players: { white: { user: { id: 'a', name: 'a' } }, black: { user: { id: 'b', name: 'b' } } } },
    { ...unanalysed, id: 'other' },
    game, // ...then with it
  ] as LichessGameJson[];
  expect(yourGames(games, 'mugglesman1982').map(g => [g.id, !!g.analysis])).toEqual([
    [game.id, true],
    ['other', false],
  ]);
});

test("a game's cards come from Lichess's analysis if it has one, otherwise from the one made here, and the game says so", () => {
  const game = fixture('real1');
  const unanalysed = { ...game, analysis: undefined };
  const madeHere = { engine: 'Stockfish 19', nodes: 1_000_000, at: '2026-10-27T15:00:00.000Z' };
  const saved = { analysis: game.analysis!, ...madeHere }; // here, the same analysis as Lichess's
  expect(withAnalysis(game, saved)).toBe(game); // Lichess's comes first
  expect(withAnalysis(unanalysed, undefined)).toBeUndefined(); // no analysis: no cards
  const analysedHere = withAnalysis(unanalysed, saved)!;
  expect(analysedHere.analysedHere).toEqual(madeHere);
  expect(cardsOfGame(analysedHere, 'white')).toEqual(cardsOfGame(game, 'white'));
});

test('cardsOfGame finds the same mistakes as retroCtrl', () => {
  expect(cardsOfGame(fixture('real1'), 'white').map(c => c.ply)).toEqual([39, 41, 63]);
  expect(cardsOfGame(fixture('real1'), 'black').map(c => c.ply)).toEqual([38, 62, 66, 74]);
  expect(cardsOfGame(fixture('real2'), 'white').map(c => c.ply)).toEqual([25, 35]);
  expect(cardsOfGame(fixture('real3'), 'black').map(c => c.ply)).toEqual([28, 38, 70]);
});

test('a card id is the game id and the ply', () => {
  const [card] = cardsOfGame(fixture('real1'), 'white');
  expect(card).toMatchObject({ id: 'oLSivxSu/39', gameId: 'oLSivxSu', ply: 39, color: 'white' });
});

test('a card knows your winning chances before and after the mistake, its move, and when it was played', () => {
  const [qh4] = cardsOfGame(fixture('real1'), 'white'); // 20.Qh4?? gave up a forced mate...
  expect(qh4).toMatchObject({ moveNumber: 20, playedAt: fixture('real1').createdAt });
  expect([qh4.chancesBefore, qh4.chancesAfter]).toEqual([0.997, -0.364]); // ...for -2.1
  const [bg7] = cardsOfGame(fixture('real1'), 'black'); // 19...Bg7?? from +1.3 allowed mate
  expect([bg7.moveNumber, bg7.chancesBefore, bg7.chancesAfter]).toEqual([19, 0.242, -0.997]);
});

// ---------- Opening mistakes and the masters database (lila's retroCtrl jumpToNext) ----------

test('only mistakes before the middlegame are checked against the masters database', () => {
  const game = fixture('real1'); // its white mistakes are at plies 39, 41, and 63
  const cards = cardsOfGame(game, 'white');
  const checked = (g: LichessGameJson) => cards.filter(c => inOpening(g, c)).map(c => c.ply);
  expect(checked({ ...game, division: { middle: 50, end: 80 } })).toEqual([39, 41]);
  expect(checked({ ...game, division: {} })).toEqual([39, 41, 63]); // never reached a middlegame
  expect(checked({ ...game, division: undefined })).toEqual([]); // no division: lila doesn't check
  expect(checked({ ...game, division: {}, variant: 'chess960' })).toEqual([]);
});

test('mistakeOf gives the position before the mistake and the move played', () => {
  const [qh4] = cardsOfGame(fixture('real1'), 'white');
  expect(mistakeOf(fixture('real1'), qh4)).toEqual({
    fen: 'r1b2rk1/pp3pbp/3qp1pQ/3n4/1P1N4/P2B4/1B3PPP/3R1RK1 w - - 4 20',
    uci: 'h6h4', // 20.Qh4
  });
});

const masterMove = (uci: string, games: number): MasterMove => ({ uci, white: games, draws: 0, black: 0 });

test("a move masters played in more than one game is a book move: the card goes; otherwise it keeps theirs", () => {
  const [card] = cardsOfGame(fixture('real1'), 'white');
  const mistake = mistakeOf(fixture('real1'), card); // 20.Qh4, h6h4
  expect(withMasterMoves(card, mistake, [masterMove('h6h4', 2)])).toBeUndefined();
  const kept = withMasterMoves(card, mistake, [masterMove('h6h4', 1), masterMove('h6g7', 5), masterMove('d4e6', 1)]);
  expect(kept).toEqual({ ...card, masterMoves: ['h6g7'] }); // one game isn't enough, for either
  expect(withMasterMoves(card, mistake, [])).toBe(card); // nothing from masters: the card as it was
});

test('castling matches, however the masters database writes it (not in lila)', () => {
  const [card] = cardsOfGame(fixture('real1'), 'white'); // any card: only the position and move matter
  const fen = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'; // the Italian, White to move
  const castled = { fen, uci: 'e1h1' }; // 4.O-O, as chessops writes it
  expect(withMasterMoves(card, castled, [masterMove('e1g1', 9)])).toBeUndefined(); // a book move
  expect(withMasterMoves(card, { fen, uci: 'd2d3' }, [masterMove('e1g1', 9)])).toEqual({ ...card, masterMoves: ['e1h1'] });
});

test("gameTimesOf: when each of your games started, newest first; for an older deck, only its games with cards", () => {
  const game = real1 as unknown as LichessGameJson;
  const newer = { ...game, id: 'newer', createdAt: 2000 };
  const older = { ...game, id: 'older', createdAt: 1000 };
  const deck = { username: 'mugglesman1982', builtAt: '', games: { older, newer }, cards: [] };
  expect(gameTimesOf(deck)).toEqual([2000, 1000]); // built before Deck.gameTimes
  expect(gameTimesOf({ ...deck, gameTimes: [3000, 2000, 1500, 1000] })).toEqual([3000, 2000, 1500, 1000]);
});

test('buildDeck: a card for each of your mistakes in your analysed games, then the saved masters answers for opening ones', async () => {
  // real1's middlegame starting at ply 50 makes two of its mistakes, at plies 39 and 41, opening ones.
  const g1 = { ...fixture('real1'), division: { middle: 50, end: 80 } };
  const [g2, g3] = ['real2', 'real3'].map(fixture);
  const unanalysed = { ...g2, id: 'noAnalys', analysis: undefined };
  const someoneElses = { ...g1, id: 'others00', players: { white: { user: { name: 'x', id: 'x' } }, black: g1.players!.black } };
  const bullet = { ...g3, id: 'bullet00', speed: 'bullet' }; // analysed, but not of the kinds you chose
  const downloaded = [g1, { ...g1, analysis: undefined }, g2, g3, unanalysed, someoneElses, bullet] as LichessGameJson[];
  const expected = [...cardsOfGame(g1, 'white'), ...cardsOfGame(g2, 'black'), ...cardsOfGame(g3, 'black')];
  // The masters database's saved answers: the first opening mistake was a book move; the second
  // position hasn't been asked about yet, so its card stays as it is, to be checked when it comes up.
  const games: Record<string, LichessGameJson> = { [g1.id]: g1, [g2.id]: g2, [g3.id]: g3 };
  const opening = expected.filter(c => inOpening(games[c.gameId], c));
  expect(opening.length).toBe(2);
  const book = mistakeOf(games[opening[0].gameId], opening[0]);
  const answers: Record<string, MasterMove[]> = { [book.fen]: [{ uci: book.uci, white: 2, draws: 0, black: 0 }] };
  const { deck, report } = await buildDeck(downloaded, {}, 'MugglesMan1982', ['blitz', 'rapid'], answers);

  expect(deck.cards.map(c => c.id)).toEqual(expected.filter(c => c !== opening[0]).map(c => c.id));
  expect(deck.cards.find(c => c.id === opening[1].id)!.masterMoves).toBeUndefined();
  expect(Object.keys(deck.games).sort()).toEqual([g1.id, g2.id, g3.id].sort());
  expect(deck.gameTimes).toEqual([g1, g2, g3].map(g => g.createdAt).sort((a, b) => b! - a!));
  expect(report).toEqual({
    skipped: { 'not yours, not standard chess, or saved twice': 2, 'not of the kinds you chose': 1, 'no computer analysis': 1 },
    opening: 2,
    bookMoves: 1,
  });
});
