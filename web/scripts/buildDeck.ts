// buildDeck.ts: Step 9. Turns your saved games into a deck of cards, one for each of your
// mistakes, and saves it where the page loads it from.
// Usage (from web): npx tsx scripts/buildDeck.ts <your Lichess username> [games.ndjson] [deck.json] [masters.json] [analysis.json]
// Defaults: ../pipeline/data/games.ndjson, public/data/deck.json, ../pipeline/data/masters.json,
// and data/analysis.json.
// The mistakes come from Lichess's computer analysis, or for a game Lichess hasn't analysed, from
// the one made on your computer, if there is one (Training settings, "Computer analysis"), which the
// dev server saves in analysis.json.
// Run it again whenever you save more games, or analyse more of them; card ids stay the same, so
// nothing is lost.
// Like lila, it checks mistakes in the opening against the masters database (mastersExplorer.ts),
// which needs your Lichess API token in ../pipeline/.env, as save_my_games.py does. The answers
// are saved in masters.json, so later builds only ask about new positions.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEnvFile } from 'node:process';

import type { SavedAnalysis } from '../src/analyses';
import {
  cardsOfGame,
  colorOf,
  inOpening,
  mistakeOf,
  withAnalysis,
  withMasterMoves,
  yourGames,
  type Card,
  type Deck,
} from '../src/deck';
import type { LichessGameJson } from '../src/tree';
import { MastersExplorer } from './mastersExplorer';

const envFile = '../pipeline/.env';

const [
  username,
  gamesFile = '../pipeline/data/games.ndjson',
  deckFile = 'public/data/deck.json',
  mastersFile = '../pipeline/data/masters.json',
  analysisFile = 'data/analysis.json',
] = process.argv.slice(2); // argv[0] is node and argv[1] is this script
if (!username)
  throw new Error(
    'Usage: npx tsx scripts/buildDeck.ts <your Lichess username> [games.ndjson] [deck.json] [masters.json] [analysis.json]',
  );

const deck: Deck = { username, builtAt: new Date().toISOString(), games: {}, cards: [] };
const skipped: Record<string, number> = {}; // reason -> number of games
const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);

// NDJSON: one game's JSON per line.
const downloaded = readFileSync(gamesFile, 'utf8')
  .split('\n')
  .flatMap((line, i): LichessGameJson[] => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      throw new Error(`${gamesFile} line ${i + 1} isn't valid JSON`);
    }
  });
// The analyses made on your computer, by game id. There's no file until the first one is saved.
const analyses: Record<string, SavedAnalysis> = existsSync(analysisFile)
  ? JSON.parse(readFileSync(analysisFile, 'utf8'))
  : {};

// The standard games you played, each once: a game saved twice is taken with Lichess's analysis, if
// either copy has it, so that Lichess's analysis always comes first (withAnalysis).
const games = yourGames(downloaded, username);
if (downloaded.length > games.length)
  skipped['not yours, not standard chess, or saved twice'] = downloaded.length - games.length;
games.forEach(g => {
  const game = withAnalysis(g, analyses[g.id]);
  if (!game) return skip('no computer analysis');

  let cards: Card[];
  try {
    cards = cardsOfGame(game, colorOf(game, username)!);
  } catch (e) {
    return skip(`couldn't read the moves (${(e as Error).message})`);
  }
  if (!cards.length) return skip('no mistakes');
  deck.games[game.id] = game;
  deck.cards.push(...cards);
});

// lila's check for mistakes in the opening (deck.ts inOpening): look up the position before each
// one in the masters database. A mistake that masters have played is a book move, so its card
// goes; the others keep the masters' moves, which count as right answers.
if (existsSync(envFile)) loadEnvFile(envFile); // LICHESS_TOKEN=...
const explorer = new MastersExplorer(mastersFile, process.env.LICHESS_TOKEN);
const opening = deck.cards.filter(c => inOpening(deck.games[c.gameId], c));
let bookMoves = 0;
for (const card of opening) {
  const mistake = mistakeOf(deck.games[card.gameId], card);
  const checked = withMasterMoves(card, mistake, await explorer.moves(mistake.fen));
  if (!checked) bookMoves++;
  deck.cards.splice(deck.cards.indexOf(card), 1, ...(checked ? [checked] : []));
}
// The deck only keeps games that still have a card.
for (const id of Object.keys(deck.games)) if (!deck.cards.some(c => c.gameId === id)) delete deck.games[id];

mkdirSync(dirname(deckFile), { recursive: true });
writeFileSync(deckFile, JSON.stringify(deck));

const gameCount = Object.keys(deck.games).length;
console.log(`${deckFile}: ${deck.cards.length} cards from ${gameCount} games`);
const analysedHere = deck.cards.filter(c => deck.games[c.gameId].analysedHere);
console.log(
  `  from games analysed on your computer: ${analysedHere.length} cards from ${new Set(analysedHere.map(c => c.gameId)).size} games`,
);
for (const [reason, count] of Object.entries(skipped)) console.log(`  skipped ${count}: ${reason}`);
console.log(`  opening mistakes checked against the masters database: ${opening.length}`);
console.log(`    requests sent to Lichess: ${explorer.requests} (positions saved before aren't asked again)`);
console.log(`    left out as book moves: ${bookMoves}`);
console.log(`    cards that also accept masters' moves: ${deck.cards.filter(c => c.masterMoves).length}`);
