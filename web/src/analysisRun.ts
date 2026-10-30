// analysisRun.ts: Not in lila. Analyses games one after another on your computer
// (localAnalysis.ts), and saves each analysis as soon as it's done (analyses.ts), so a run can be
// paused, or the page closed, and taken up again later. Training settings runs it on your games
// Lichess hasn't analysed (yourGames.ts).
// analysisRunView.ts draws it.

import { saveAnalysis, type SavedAnalysis } from './analyses';
import { ENGINE_NAME, GAME_NODES, stopEngines } from './fishnet';
import { analyseGame } from './localAnalysis';
import type { LichessAnalysisEntry, LichessGameJson } from './tree';

const positionsOf = (game: LichessGameJson): number => game.moves.split(' ').filter(san => san !== '').length + 1;

export class AnalysisRun {
  running = false;
  pausing = false; // pause was pressed, and the run is stopping
  current?: { game: LichessGameJson; done: number; total: number }; // the game being analysed
  failed: Record<string, string> = {}; // games that couldn't be analysed, with why, this time
  error = ''; // why the run stopped, if not paused or finished
  private abort?: AbortController;
  private startedAt = 0; // when this run started (performance.now)
  private positionsDone = 0; // in this run

  constructor(
    readonly games: LichessGameJson[], // the games to analyse, in the order to analyse them
    readonly saved: Record<string, SavedAnalysis>, // the analyses made here, by game
    private readonly redraw: () => void,
  ) {}

  waiting = (): LichessGameJson[] => this.games.filter(g => !this.saved[g.id] && !this.failed[g.id]);

  // Analyses each game that hasn't been analysed here yet, and saves it, until all are done or the
  // run is paused. Then the engines stop, to give back their memory.
  start = async (): Promise<void> => {
    if (this.running) return;
    this.running = true;
    this.error = '';
    this.abort = new AbortController();
    const { signal } = this.abort;
    this.startedAt = performance.now();
    this.positionsDone = 0;
    this.redraw();
    for (const game of this.waiting()) {
      this.current = { game, done: 0, total: positionsOf(game) };
      let analysis: LichessAnalysisEntry[];
      try {
        analysis = await analyseGame(
          game,
          (done, total) => {
            this.current = { game, done, total };
            this.positionsDone++;
            this.redraw();
          },
          signal,
        );
      } catch (e) {
        if (signal.aborted) break;
        this.failed[game.id] = (e as Error).message; // e.g. moves it can't read: on to the next game
        continue;
      }
      const saved: SavedAnalysis = { analysis, engine: ENGINE_NAME, nodes: GAME_NODES, at: new Date().toISOString() };
      try {
        await saveAnalysis(game.id, saved);
      } catch (e) {
        this.error = (e as Error).message;
        break;
      }
      this.saved[game.id] = saved;
    }
    stopEngines();
    this.running = this.pausing = false;
    this.current = undefined;
    this.redraw();
  };

  // Stops the run: the engines stop searching at once. That game's analysis isn't saved, as it isn't
  // finished: next time, it's analysed again in full.
  pause = (): void => {
    this.pausing = true;
    this.abort?.abort();
    this.redraw();
  };

  // How long one position has taken in this run, and the time the rest should take at that pace,
  // in seconds; undefined until a few positions are done.
  pace = (): { perPosition: number; left: number } | undefined => {
    if (!this.running || this.positionsDone < 3) return undefined;
    const perPosition = (performance.now() - this.startedAt) / 1000 / this.positionsDone;
    const positionsLeft = this.waiting().reduce((sum, g) => sum + positionsOf(g), 0) - (this.current?.done ?? 0);
    return { perPosition, left: positionsLeft * perPosition };
  };
}
