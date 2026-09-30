// buildDeck.ts: Step 9. Turns your saved games into a deck of cards, one for each of your
// mistakes, and saves it where the page loads it from.
// Usage (from web): npx tsx scripts/buildDeck.ts <your Lichess username> [games.ndjson] [deck.json]
// Defaults: ../pipeline/data/games.ndjson and public/data/deck.json.
// Run it again whenever you save more games; card ids stay the same, so nothing is lost.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { cardsOfGame, colorOf, type Card, type Deck } from '../src/deck';
import type { LichessGameJson } from '../src/tree';

const [username, gamesFile = '../pipeline/data/games.ndjson', deckFile = 'public/data/deck.json'] =
  process.argv.slice(2); // argv[0] is node and argv[1] is this script
if (!username) throw new Error('Usage: npx tsx scripts/buildDeck.ts <your Lichess username> [games.ndjson] [deck.json]');

const deck: Deck = { username, builtAt: new Date().toISOString(), games: {}, cards: [] };
const skipped: Record<string, number> = {}; // reason -> number of games
const skip = (reason: string) => (skipped[reason] = (skipped[reason] ?? 0) + 1);

// NDJSON: one game's JSON per line.
const lines = readFileSync(gamesFile, 'utf8').split('\n');
lines.forEach((line, i) => {
  if (!line.trim()) return;
  let game: LichessGameJson;
  try {
    game = JSON.parse(line);
  } catch {
    throw new Error(`${gamesFile} line ${i + 1} isn't valid JSON`);
  }
  const color = colorOf(game, username);
  if (!color) return skip(`${username} didn't play`);
  if (game.variant && game.variant !== 'standard') return skip(`variant ${game.variant}`);
  if (!game.analysis) return skip('no computer analysis');
  if (deck.games[game.id]) return skip('saved twice');

  let cards: Card[];
  try {
    cards = cardsOfGame(game, color);
  } catch (e) {
    return skip(`couldn't read the moves (${(e as Error).message})`);
  }
  if (!cards.length) return skip('no mistakes');
  deck.games[game.id] = game;
  deck.cards.push(...cards);
});

mkdirSync(dirname(deckFile), { recursive: true });
writeFileSync(deckFile, JSON.stringify(deck));

const gameCount = Object.keys(deck.games).length;
console.log(`${deckFile}: ${deck.cards.length} cards from ${gameCount} games`);
for (const [reason, count] of Object.entries(skipped)) console.log(`  skipped ${count}: ${reason}`);
