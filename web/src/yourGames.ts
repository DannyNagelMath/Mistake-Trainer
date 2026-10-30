// yourGames.ts: Not in lila. Your games of the kinds you chose, for "Computer analysis" in Training
// settings: how many Lichess has analysed, and a run of analyses (analysisRun.ts) on the others,
// newest first, here on your computer. Their cards join the deck when it's next built (Update deck,
// deckUpdate.ts).
// trainer.ts makes it once, as the page opens, and it loads your games the first time Training
// settings opens. So a run goes on while you train, and Training settings shows how far it has got
// whenever you come back to it.

import { loadAnalyses } from './analyses';
import { AnalysisRun } from './analysisRun';
import { loadGames, yourGames } from './deck';
import type { Speed } from './gameDownload';

export class YourGamesCtrl {
  // Once your games have loaded: how many there are, how many Lichess has analysed, and the run on
  // the others.
  loaded?: { all: number; byLichess: number; run: AnalysisRun };
  error = ''; // why they couldn't load
  private loading = false;

  constructor(
    private readonly username: string,
    private readonly speeds: () => Speed[], // the kinds of games you chose, as they are when your games load
    private readonly redraw: () => void,
  ) {}

  // Loads your downloaded games and the analyses made here, unless that's done or under way. If
  // they can't load, the next call tries again.
  load = async (): Promise<void> => {
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      const [games, saved] = await Promise.all([loadGames(), loadAnalyses()]);
      const speeds = this.speeds();
      const yours = yourGames(games, this.username).filter(g => speeds.includes(g.speed as Speed));
      const others = yours.filter(g => !g.analysis).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      this.loaded = { all: yours.length, byLichess: yours.length - others.length, run: new AnalysisRun(others, saved, this.redraw) };
    } catch (e) {
      this.error = (e as Error).message;
      this.loading = false;
    }
    this.redraw();
  };
}
