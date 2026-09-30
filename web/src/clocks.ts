// clocks.ts: Step 8. Each player's clock at the position on the board, from the times recorded
// in the game. From lila's ui/analyse/src/view/clocks.ts (master, commit 27ffc8b).
// Every change from lila's version is marked with a comment starting "Trim:".

import { h, type VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';

interface ClockOpts {
  centis?: number;
  active: boolean; // whose turn it is
  cls: string;
  showTenths: boolean;
}

// Trim: lila's is in ui/lib/src/game/chess.ts. The color to move after `ply` half-moves.
const plyColor = (ply: number) => (ply % 2 === 0 ? 'white' : 'black');

// [white's clock, black's clock], or undefined if the game has no clock times.
// A node only has the clock of the player who just moved, so the other player's clock comes
// from the node before it.
export default function renderClocks(ctrl: AnalysisCtrl, path: string): [VNode, VNode] | undefined {
  const node = ctrl.tree.nodeAtPath(path),
    whitePov = ctrl.bottomColor() === 'white', // lila's ctrl.bottomIsWhite()
    // lila's tree.getParentClock
    parentClock = path ? ctrl.tree.nodeAtPath(path.slice(0, -2)).clock : node.clock,
    isWhiteTurn = plyColor(node.ply) === 'white',
    centis: Array<number | undefined> = (isWhiteTurn ? [parentClock, node.clock] : [node.clock, parentClock]).map(
      c => (c !== undefined && c < 0 ? undefined : c),
    );

  if (!centis.some(c => c !== undefined && c !== null)) return undefined;

  // Trim: lila runs the clock down while a broadcast or autoplay is waiting for the next move,
  // and can show a pause icon for broadcasts.
  const showTenths = true;

  return [
    renderClock({ centis: centis[0], active: isWhiteTurn, cls: whitePov ? 'bottom' : 'top', showTenths }),
    renderClock({ centis: centis[1], active: !isWhiteTurn, cls: whitePov ? 'top' : 'bottom', showTenths }),
  ];
}

// Trim: lila writes the time out in words for screen readers (blind mode).
const renderClock = (opts: ClockOpts): VNode =>
  h('div.analyse__clock.' + opts.cls, { class: { active: opts.active } }, clockContent(opts));

// e.g. "4:59", "0:09.3" (tenths under a minute), or "1:05:00" over an hour.
function clockContent(opts: ClockOpts): (VNode | string)[] {
  if (!opts.centis && opts.centis !== 0) return ['-'];
  const date = new Date(opts.centis * 10),
    millis = date.getUTCMilliseconds(),
    sep = ':',
    baseStr = pad2(date.getUTCMinutes()) + sep + pad2(date.getUTCSeconds());
  const timeNodes =
    !opts.showTenths || opts.centis >= 360000
      ? [Math.floor(opts.centis / 360000) + sep + baseStr]
      : opts.centis >= 6000
        ? [baseStr]
        : [baseStr, h('tenths', '.' + Math.floor(millis / 100).toString())];
  return timeNodes;
}

const pad2 = (num: number): string => (num < 10 ? '0' : '') + num;
