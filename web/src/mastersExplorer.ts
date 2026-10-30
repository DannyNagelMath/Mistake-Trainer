// mastersExplorer.ts: Step 9. Looks positions up in Lichess's masters database (the opening
// explorer), for buildDeck (deck.ts), as lila's "Learn from your mistakes" does for opening mistakes
// (lila's ui/analyse/src/explorer/explorerCtrl.ts fetchMasterOpening, master, commit 27ffc8b).
//
// Being gentle with Lichess's servers, as its API documentation asks
// (https://lichess.org/api, "Rate limiting"):
//   - each position is looked up once, ever: the answers are saved and reused, so building the
//     deck again only asks about new positions;
//   - one request at a time, at least 3 seconds apart (a second apart, the explorer once answered
//     429 within the first 60 requests);
//   - only the moves, without the lists of games (topGames=0), as lila asks;
//   - if Lichess answers 429 (too many requests), wait a full minute and try once more, then stop.
// The explorer needs a Lichess token: from signing in to Lichess (lichessAuth.ts), or on the command
// line, a personal API token. Without one, new positions aren't checked, until a build that has one.

import type { Masters, MasterMove } from './deck';

const ENDPOINT = 'https://explorer.lichess.org/masters';
export const GAP = 3000; // milliseconds between requests

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MastersExplorer implements Masters {
  private lastRequest = 0;
  requests = 0; // sent to Lichess, retries included
  readonly skipped = new Set<string>(); // new positions not checked, for want of a token

  constructor(
    private readonly answers: Record<string, MasterMove[]>, // the saved answers, by FEN; new ones join them
    private readonly token: string | undefined,
    // Saves a new answer, after every one, so that stopping halfway loses nothing.
    private readonly save: (fen: string, moves: MasterMove[]) => void | Promise<void>,
    private readonly wait = sleep,
  ) {}

  // Whether looking the position up asks Lichess nothing: its answer is saved, or there's no token
  // to ask with.
  has = (fen: string): boolean => fen in this.answers || !this.token;

  // The moves masters have played from the position: the saved answer, or Lichess's. Without a
  // token, none, for a new position: its card is kept as it is.
  async moves(fen: string): Promise<MasterMove[]> {
    const saved = this.answers[fen];
    if (saved) return saved;
    if (!this.token) {
      this.skipped.add(fen);
      return [];
    }
    const moves = await this.ask(fen, this.token);
    this.answers[fen] = moves;
    await this.save(fen, moves);
    return moves;
  }

  private async ask(fen: string, token: string, retry = true): Promise<MasterMove[]> {
    await this.wait(Math.max(0, this.lastRequest + GAP - Date.now()));
    const url = new URL(ENDPOINT);
    url.searchParams.set('fen', fen);
    url.searchParams.set('topGames', '0');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    this.lastRequest = Date.now();
    this.requests++;
    if (response.status === 429) {
      if (!retry) throw new Error('Lichess asked to slow down again (429). Stopping; the answers so far are saved.');
      await this.wait(60_000);
      return this.ask(fen, token, false);
    }
    if (!response.ok) throw new Error(`The opening explorer answered ${response.status}: ${await response.text()}`);
    const { moves } = (await response.json()) as { moves: MasterMove[] };
    return moves.map(({ uci, white, draws, black }) => ({ uci, white, draws, black })); // only what's used
  }
}
