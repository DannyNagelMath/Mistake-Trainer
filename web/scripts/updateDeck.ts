// updateDeck.ts: adds your new games to the deck in one go. It downloads the games you've played
// since the last download (../pipeline/save_my_games.py --update), then builds the deck again
// (buildDeck.ts), which only asks the masters database about new positions.
// Usage (from web): npm run update-deck
// It builds the deck for the username the current deck was built for. The first time, build it
// with buildDeck.ts and your username. (save_my_games.py has its own USERNAME: keep them the same.)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const deckFile = 'public/data/deck.json';
if (!existsSync(deckFile))
  throw new Error('No deck yet. Build the first one with: npx tsx scripts/buildDeck.ts <your Lichess username>');
const { username } = JSON.parse(readFileSync(deckFile, 'utf8')) as { username: string };

// The pipeline's own Python if it has one (a virtual environment in ../pipeline/.venv, with the
// packages save_my_games.py needs), otherwise whichever Python is installed.
const venv = process.platform === 'win32' ? '../pipeline/.venv/Scripts/python.exe' : '../pipeline/.venv/bin/python';
const python = existsSync(venv) ? venv : 'python';

// Runs a command, showing its output, and stops here if it fails.
function run(command: string, args: string[]): void {
  const { status, error } = spawnSync(command, args, { stdio: 'inherit' });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

console.log('Downloading your new games...');
run(python, ['../pipeline/save_my_games.py', '--update']);
console.log(`\nBuilding the deck for ${username}...`);
run(process.execPath, ['--import', 'tsx', 'scripts/buildDeck.ts', username]); // node, with tsx for TypeScript
