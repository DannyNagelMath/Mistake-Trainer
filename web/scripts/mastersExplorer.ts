// mastersExplorer.ts: Step 9. Looks positions up in Lichess's masters database (the opening
// explorer), for buildDeck.ts, as lila's "Learn from your mistakes" does for opening mistakes
// (lila's ui/analyse/src/explorer/explorerCtrl.ts fetchMasterOpening, master, commit 27ffc8b).
//
// Being gentle with Lichess's servers, as its API documentation asks
// (https://lichess.org/api, "Rate limiting"):
//   - each position is looked up once, ever: the answers are saved in a file and reused, so
//     building the deck again only asks about new positions;
//   - one request at a time, at least 3 seconds apart (a second apart, the explorer once answered
//     429 within the first 60 requests);
//   - only the moves, without the lists of games (topGames=0), as lila asks;
//   - if Lichess answers 429 (too many requests), wait a full minute and try once more, then stop.
// The explorer needs a Lichess API token. Any personal token will do: it needs no permissions.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { MasterMove } from '../src/deck';

const ENDPOINT = 'https://explorer.lichess.org/masters';
const GAP = 3000; // milliseconds between requests

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MastersExplorer {
  private readonly answers: Record<string, MasterMove[]>; // the saved answers, by FEN
  private lastRequest = 0;
  requests = 0; // sent to Lichess this run, retries included

  // The token is only needed for positions that haven't been looked up before.
  constructor(
    private readonly file: string,
    private readonly token: string | undefined,
  ) {
    this.answers = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  }

  // The moves masters have played from the position: the saved answer, or Lichess's.
  async moves(fen: string): Promise<MasterMove[]> {
    const saved = this.answers[fen];
    if (saved) return saved;
    const moves = await this.ask(fen);
    this.answers[fen] = moves;
    this.save(); // after every answer, so stopping halfway loses nothing
    return moves;
  }

  private async ask(fen: string, retry = true): Promise<MasterMove[]> {
    if (!this.token)
      throw new Error('The opening explorer needs a Lichess API token: put LICHESS_TOKEN=... in pipeline/.env');
    await sleep(Math.max(0, this.lastRequest + GAP - Date.now()));
    const url = new URL(ENDPOINT);
    url.searchParams.set('fen', fen);
    url.searchParams.set('topGames', '0');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    this.lastRequest = Date.now();
    this.requests++;
    if (response.status === 429) {
      if (!retry)
        throw new Error('Lichess asked us to slow down again (429). Stopping; the answers so far are saved.');
      console.log('Lichess asked us to slow down (429). Waiting a minute...');
      await sleep(60_000);
      return this.ask(fen, false);
    }
    if (!response.ok) throw new Error(`The opening explorer answered ${response.status}: ${await response.text()}`);
    const { moves } = (await response.json()) as { moves: MasterMove[] };
    return moves.map(({ uci, white, draws, black }) => ({ uci, white, draws, black })); // only what's used
  }

  // Writes a temporary file, then renames it over the old one, so a crash can't leave half a file.
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.answers, null, 1));
    renameSync(this.file + '.tmp', this.file);
  }
}
