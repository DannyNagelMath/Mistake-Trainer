// deckUpdate.ts: Not in lila. "Update deck" in Training settings, and the first deck, on the
// first-run screen (setupView.ts): downloads the games you've played since from Lichess
// (gameDownload.ts), builds the deck again (deck.ts buildDeck), and saves it. It all happens in the
// page; the dev server only keeps the files (vite.config.ts).
// trainer.ts makes it once, as the page opens, so an update goes on after Training settings closes.

import { buildDeck, type Deck } from './deck';
import { downloadNewGames, type Speed } from './gameDownload';
import { loadAnalyses, loadGames, loadMasters, saveDeck, saveGames } from './storage';

// e.g. "1 game", "12 games".
const count = (n: number, noun: string): string => `${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;

export class DeckUpdateCtrl {
  state: 'idle' | 'running' | 'done' | 'failed' = 'idle';
  lines: string[] = []; // what it has done so far; after a failure, the last line says why
  built?: Deck; // the deck it built, once done

  constructor(
    private readonly username: string,
    private readonly speeds: () => Speed[], // the kinds of games you chose, as they are when it starts
    private readonly redraw: () => void,
  ) {}

  // Starts an update, unless one is running already.
  start = async (): Promise<void> => {
    if (this.state === 'running') return;
    this.state = 'running';
    this.lines = [];
    this.built = undefined;
    try {
      this.built = await this.update();
      this.state = 'done';
    } catch (e) {
      this.lines.push((e as Error).message);
      this.state = 'failed';
    }
    this.redraw();
  };

  private async update(): Promise<Deck> {
    this.say('Downloading your new games from Lichess...');
    const speeds = this.speeds();
    const saved = await loadGames();
    const downloaded = await downloadNewGames(this.username, speeds, saved, n => {
      if (n % 50 === 0) this.sayInstead(`Downloading your new games from Lichess: ${n}...`);
    });
    await saveGames(downloaded);
    const known = new Set(saved.map(g => g.id));
    const added = downloaded.filter(g => !known.has(g.id)).length;
    this.sayInstead(`Downloaded ${count(added, 'new game')} from Lichess.`);

    this.say('Building your deck...');
    const [games, analyses, answers] = await Promise.all([loadGames(), loadAnalyses(), loadMasters()]);
    const { deck } = await buildDeck(games, analyses, this.username, speeds, answers);
    await saveDeck(deck);
    this.say(`Built: ${count(deck.cards.length, 'card')} from ${count(Object.keys(deck.games).length, 'game')}.`);
    return deck;
  }

  private say(line: string): void {
    this.lines.push(line);
    this.redraw();
  }

  // The last line, replaced, as it gets on.
  private sayInstead(line: string): void {
    this.lines[this.lines.length - 1] = line;
    this.redraw();
  }
}
