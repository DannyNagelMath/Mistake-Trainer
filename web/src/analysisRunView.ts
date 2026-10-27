// analysisRunView.ts: Not in lila. Draws a run of analyses (analysisRun.ts): how far it has got, how
// long the rest should take, and a button to start it, pause it, or carry on.

import type { VNode } from 'snabbdom';

import type { AnalysisRun } from './analysisRun';
import { hl } from './snabbdom';

export function renderRun(run: AnalysisRun): VNode {
  const done = run.games.filter(g => run.saved[g.id]).length;
  const failed = Object.entries(run.failed);
  const pace = run.pace();
  const current = run.current;
  return hl('div.mt-run', [
    hl('p', [
      `${count(done)} of ${count(run.games.length)} games analysed here.`,
      current &&
        ` Now game ${count(done + 1)}` +
          (current.game.createdAt ? `, played ${new Date(current.game.createdAt).toLocaleDateString()}` : '') +
          `: position ${current.done} of ${current.total}.`,
      pace && ` About ${duration(pace.left)} to go, at ${pace.perPosition.toFixed(1)} seconds a position.`,
    ]),
    run.running
      ? hl('button.button', { attrs: { disabled: run.pausing }, on: { click: run.pause } }, run.pausing ? 'Pausing…' : 'Pause')
      : run.waiting().length > 0 && hl('button.button', { on: { click: run.start } }, done ? 'Carry on' : 'Start'),
    run.error && hl('p.mt-run__error', run.error),
    failed.length > 0 &&
      hl('p.mt-run__error', `Couldn't analyse: ${failed.map(([id, why]) => `${id} (${why})`).join(', ')}`),
  ]);
}

const count = (n: number): string => n.toLocaleString('en');

// e.g. "1 h 12 min", or "under a minute"
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'under a minute';
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
