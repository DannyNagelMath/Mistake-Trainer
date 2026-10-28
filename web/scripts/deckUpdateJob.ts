// deckUpdateJob.ts: Not in lila. The dev server's side of "Update deck" in Training settings
// (vite.config.ts /api/update-deck, src/deckUpdate.ts): runs updateDeck.ts, as npm run update-deck
// does, in the background, and keeps what it prints, for the page to show.

import { spawn } from 'node:child_process';

import type { DeckUpdate } from '../src/deckUpdate.ts';

const LINES_KEPT = 200; // the latest; the masters check prints a line for every 10 positions

export class DeckUpdateJob {
  status: DeckUpdate = { state: 'idle', lines: [] };

  // What to run, with its arguments, and where: e.g. node, with tsx and scripts/updateDeck.ts.
  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
  ) {}

  // Starts an update, unless one is running already: then that's the one to follow.
  start = (): void => {
    if (this.status.state === 'running') return;
    const status: DeckUpdate = (this.status = { state: 'running', lines: [], startedAt: new Date().toISOString() });
    let partial = ''; // what came after the last complete line, until the rest of it arrives
    const add = (text: string) => {
      const lines = (partial + text).split(/\r?\n/);
      partial = lines.pop()!;
      status.lines.push(...lines);
      status.lines.splice(0, status.lines.length - LINES_KEPT);
    };
    const end = (state: 'done' | 'failed', why?: string) => {
      if (status.state !== 'running') return; // after an error, Node may still say it closed
      status.lines.push(...[partial, why ?? ''].filter(Boolean));
      status.state = state;
      status.endedAt = new Date().toISOString();
    };
    // Python holds back what it prints, and sends it all at the end, when another program runs
    // it; told not to, the download (save_my_games.py) reports as it goes.
    const child = spawn(this.command, this.args, { cwd: this.cwd, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    child.stdout.on('data', (chunk: Buffer) => add(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => add(chunk.toString()));
    child.on('error', e => end('failed', e.message)); // it couldn't start
    child.on('close', code => end(code === 0 ? 'done' : 'failed'));
  };
}
