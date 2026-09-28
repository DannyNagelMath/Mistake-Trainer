// checkSwings.ts: lists the moves "Learn from your mistakes" would quiz, for each color.
// Usage: npx tsx scripts/checkSwings.ts [path/to/game.json]   (default: fixtures/game1.json)

import { readFileSync } from 'node:fs';
import { evalSwings } from '../src/nodeFinder';
import { buildTree, mainline, type LichessGameJson } from '../src/tree';

const file = process.argv[2] ?? 'fixtures/game1.json';
const game: LichessGameJson = JSON.parse(readFileSync(file, 'utf8'));
const line = mainline(buildTree(game));

for (const color of ['white', 'black'] as const) {
  const colorModulo = color === 'white' ? 1 : 0; // same test retroCtrl uses
  const found = evalSwings(line, n => n.ply % 2 === colorModulo);
  const moves = found.map(n => `ply ${n.ply} ${n.san}${n.glyphs?.[0].symbol ?? ''}`);
  console.log(`${color}: ${found.length} to learn from${moves.length ? ': ' + moves.join(', ') : ''}`);
}