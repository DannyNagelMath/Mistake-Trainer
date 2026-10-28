// deckUpdate.ts: Not in lila. "Update deck" in Training settings: the dev server downloads your new
// games and builds the deck again, as npm run update-deck does (vite.config.ts /api/update-deck,
// scripts/deckUpdateJob.ts), and this follows how it's going.
// main.ts makes it once, as the page opens, so an update you start goes on being followed after
// Training settings closes, and shows how it stands whenever you come back to it.

import { loadDeck, type Deck } from './deck';

// How the update stands, as the dev server says. `lines`: what it has printed so far.
export interface DeckUpdate {
  state: 'idle' | 'running' | 'done' | 'failed';
  lines: string[];
  startedAt?: string; // ISO dates
  endedAt?: string;
}

const FOLLOW = 1000; // milliseconds between asking how it's going

// The line that says why an update failed, if one does: Node's "Error: ...", or the last line of
// Python's, e.g. "requests.exceptions.HTTPError: 429 Client Error: Too Many Requests for url: ...".
export const failureReason = (lines: string[]): string | undefined =>
  [...lines].reverse().find(line => /^[\w.]*(Error|Exception)\b[^:]*:/.test(line));

export async function loadDeckUpdate(): Promise<DeckUpdate> {
  const response = await fetch('/api/update-deck');
  // A dev server started before /api/update-deck was added answers with the page itself.
  if (!response.ok || !response.headers.get('content-type')?.includes('json'))
    throw new Error(`Couldn't ask how the deck update stands (${response.status}). Restart the dev server (npm run dev).`);
  return response.json();
}

// Starts an update, unless one is running already: then there's nothing to start, and it can be
// followed all the same.
export async function startDeckUpdate(): Promise<void> {
  const response = await fetch('/api/update-deck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`Couldn't update the deck (${response.status}). Restart the dev server (npm run dev).`);
}

export class DeckUpdateCtrl {
  status?: DeckUpdate; // once the dev server has said
  error = ''; // why the dev server couldn't be asked
  built?: Deck; // the deck an update built, once it's done, if the page doesn't have it yet
  private following = false;

  constructor(
    private readonly deckBuiltAt: string, // when the deck the page has was built
    private readonly redraw: () => void,
  ) {}

  // Whether an update has built a deck since the page's was built: reloading the page brings it in.
  newDeck = (): boolean => this.status?.state === 'done' && (this.status.startedAt ?? '') > this.deckBuiltAt;

  // Asks how the update stands: when Training settings opens, and then every second while it runs.
  load = async (): Promise<void> => {
    if (this.following) return;
    if ((await this.ask()) && this.status?.state === 'running') this.follow();
  };

  start = async (): Promise<void> => {
    this.built = undefined;
    try {
      await startDeckUpdate();
    } catch (e) {
      this.error = (e as Error).message;
      return this.redraw();
    }
    await this.load();
  };

  // Whether the dev server answered.
  private async ask(): Promise<boolean> {
    try {
      this.status = await loadDeckUpdate();
      this.error = '';
      if (this.newDeck() && !this.built) this.built = await loadDeck();
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    } finally {
      this.redraw();
    }
  }

  private follow(): void {
    this.following = true;
    setTimeout(async () => {
      if ((await this.ask()) && this.status?.state === 'running') this.follow();
      else this.following = false;
    }, FOLLOW);
  }
}
