// yourGames.ts: Not in lila. Your games, for "Computer analysis" in Training settings: how many
// Lichess has analysed, which your cards come from, and a run of analyses (analysisRun.ts) on the
// others, newest first, here on your computer. main.ts makes it once, as the page opens, and it
// loads your games the first time Training settings opens. So a run goes on while you train, and
// Training settings shows how far it has got whenever you come back to it.

import { loadAnalyses } from './analyses';
import { AnalysisRun } from './analysisRun';
import { loadGames, yourGames } from './deck';

export class YourGamesCtrl {
  // Once your games have loaded: how many there are, how many Lichess has analysed, and the run on
  // the others.
  loaded?: { all: number; byLichess: number; run: AnalysisRun };
  error = ''; // why they couldn't load
  private loading = false;

  constructor(
    private readonly username: string,
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
      const yours = yourGames(games, this.username);
      const others = yours.filter(g => !g.analysis).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      this.loaded = { all: yours.length, byLichess: yours.length - others.length, run: new AnalysisRun(others, saved, this.redraw) };
    } catch (e) {
      this.error = (e as Error).message;
      this.loading = false;
    }
    this.redraw();
  };
}
