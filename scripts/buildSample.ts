// buildSample.ts: makes public/sample.json, the sample deck on the first-run screen (backup.ts
// trySample): an export of a deck built from the 20 latest analysed games in the data folder, with
// nothing else of its owner's: no reviews, and the default settings.
// Run from the top folder: npx tsx scripts/buildSample.ts

import { readFileSync, writeFileSync } from 'node:fs';

import type { SavedAnalysis } from '../src/analyses.ts';
import { buildDeck, withAnalysis, yourGames, type Deck, type MasterMove } from '../src/deck.ts';
import type { Speed } from '../src/gameDownload.ts';
import { defaultSettings } from '../src/settings.ts';
import { buildTree, mainline, type LichessGameJson } from '../src/tree.ts';

const GAMES = 20;
const read = (file: string) => readFileSync(`data/${file}`, 'utf8');

const { username } = JSON.parse(read('deck.json')) as Deck;
const downloaded: LichessGameJson[] = read('games.ndjson').split('\n').filter(Boolean).map(line => JSON.parse(line));
const analyses: Record<string, SavedAnalysis> = JSON.parse(read('analysis.json'));
const answers: Record<string, MasterMove[]> = JSON.parse(read('masters.json'));

const games = yourGames(downloaded, username)
  .filter(g => defaultSettings.gameTypes.includes(g.speed as Speed) && withAnalysis(g, analyses[g.id]))
  .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  .slice(0, GAMES);
// The analyses made on your computer that the deck uses: for games Lichess hasn't analysed.
const sampleAnalyses = Object.fromEntries(games.filter(g => !g.analysis && analyses[g.id]).map(g => [g.id, analyses[g.id]]));
// The masters database's answers for the positions in these games, so their opening cards are
// checked without signing in.
const fens = new Set(games.flatMap(g => mainline(buildTree(withAnalysis(g, analyses[g.id])!)).map(n => n.fen)));
const masters = Object.fromEntries(Object.entries(answers).filter(([fen]) => fens.has(fen)));
const deck = await buildDeck(games, sampleAnalyses, username, defaultSettings.gameTypes, masters);

const sample = {
  app: 'Mistake Trainer',
  version: 1,
  exportedAt: new Date().toISOString(),
  reviews: { cards: {}, log: [] },
  settings: defaultSettings,
  analyses: sampleAnalyses,
  games,
  masters,
  deck,
};
writeFileSync('public/sample.json', JSON.stringify(sample));
console.log(`public/sample.json: ${deck.cards.length} cards from ${Object.keys(deck.games).length} of ${games.length} games.`);
