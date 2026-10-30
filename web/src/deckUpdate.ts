// deckUpdate.ts: Not in lila. "Update deck" in Training settings, and the first deck, on the
// first-run screen (setupView.ts): downloads the games you've played since from Lichess
// (gameDownload.ts), builds the deck again (deck.ts buildDeck), checking new opening mistakes against
// the masters database if you're signed in to Lichess (mastersExplorer.ts), and saves it. It all
// happens in the page; the dev server only keeps the files (vite.config.ts).
// trainer.ts makes it once, as the page opens, so an update goes on after Training settings closes.

import { loadAnalyses } from './analyses';
import { buildDeck, loadGames, loadMasters, saveDeck, saveGames, saveMasterMoves, type Deck } from './deck';
import { downloadNewGames, type Speed } from './gameDownload';
import { signedIn } from './lichessAuth';
import { GAP, MastersExplorer } from './mastersExplorer';

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
    const explorer = new MastersExplorer(answers, signedIn()?.token, saveMasterMoves);
    const { deck } = await buildDeck(games, analyses, this.username, speeds, explorer, (asked, toAsk) => {
      const minutes = Math.ceil((toAsk * GAP) / 60_000);
      if (!asked) this.say(`Asking the masters database about ${count(toAsk, 'new opening position')} (about ${minutes} min)...`);
      else if (asked % 10 === 0 || asked === toAsk) this.sayInstead(`Asking the masters database: ${asked} of ${toAsk}...`);
    });
    await saveDeck(deck);
    this.say(`Built: ${count(deck.cards.length, 'card')} from ${count(Object.keys(deck.games).length, 'game')}.`);
    const unchecked = explorer.skipped.size;
    if (unchecked)
      this.say(
        `${count(unchecked, 'new opening position')} ${unchecked === 1 ? 'wasn’t' : 'weren’t'} checked against the masters ` +
          'database. To check them, sign in with Lichess, then update again.',
      );
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
