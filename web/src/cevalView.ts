// cevalView.ts: the engine's box above the move list (its switch, evaluation, name, and depth),
// and its line under it. From lila's ui/lib/src/ceval/view/main.ts (renderCeval,
// renderCevalSwitch, localEvalNodes, localInfo, engineName, renderPvs, renderPv, renderPvMoves)
// and ui/lib/src/view/cmn-toggle.ts (master, commit 27ffc8b). Every change from lila's version is
// marked with a comment starting "Trim:".
// Trim: no engine settings (lila's gear), threat mode, "go deeper", positions per second, analyses
// from the cloud, several lines, or the small board that shows a line's position as you point
// at its moves.

import { parseUci } from 'chessops';
import { Chess, type Position } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderEval } from './components';
import { ANALYSIS_MILLIS, ENGINE_NAME, isAnalysing, MULTI_THREADED, type EngineEval } from './engine';
import { getBestEval } from './evalGauge';
import { i18n } from './i18n';
import { hl, onInsert, type LooseVNodes } from './snabbdom';
import type { TreeNode } from './tree';

const positionOf = (node: TreeNode): Position => Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();

// The status under the engine's name. Trim: lila also says when the engine is loading or has
// failed, and offers to go deeper.
function localEvalNodes(ctrl: AnalysisCtrl, client?: EngineEval, server?: TreeNode['eval']): string[] {
  if (!client) return [server && ctrl.nextNodeBest() ? i18n.site.usingServerAnalysis : i18n.site.calculatingMoves];
  return [client.depth > 0 ? i18n.site.depthX(client.depth) : ''];
}

// Trim: lila lets you choose among several engines; this is the one we have. As in lila, the
// technology shows as good when the engine runs on several threads.
const engineName = (): VNode[] => [
  hl('span', { attrs: { title: ENGINE_NAME } }, ENGINE_NAME),
  hl(
    'span.technology',
    {
      class: { good: MULTI_THREADED },
      attrs: { title: MULTI_THREADED ? 'Multi-threaded WebAssembly' : 'Single-threaded WebAssembly' },
    },
    'NNUE',
  ),
];

export function renderCeval(ctrl: AnalysisCtrl): VNode {
  const node = ctrl.node,
    enabled = ctrl.cevalEnabled(),
    client = node.ceval,
    server = node.eval,
    bestEv = getBestEval(ctrl),
    over = !!positionOf(node).outcome(),
    computing = isAnalysing();
  let pearl: VNode,
    percent = 0;
  if (client) percent = Math.min(100, (100 * client.millis) / ANALYSIS_MILLIS); // lila's search by movetime
  if (typeof bestEv?.cp !== 'undefined') pearl = hl('pearl', renderEval(bestEv.cp));
  else if (bestEv?.mate !== undefined) pearl = hl('pearl', '#' + bestEv.mate);
  else {
    if (!enabled) pearl = hl('pearl', hl('icon'));
    else if (over) pearl = hl('pearl', '-');
    else pearl = hl('pearl', hl('icon.ddloader'));
    percent = over ? 100 : 0;
  }
  if (percent > 0 && !computing) percent = 100;

  const progressBar: VNode | false =
    enabled && hl('div.bar', hl('span', { attrs: { style: `width: ${percent}%` }, key: `${node.ply}_${node.id}` }));

  const body: LooseVNodes = enabled
    ? [
        pearl,
        hl('div.engine', [engineName(), hl('span.info', over ? [i18n.site.gameOver] : localEvalNodes(ctrl, client, server))]),
      ]
    : [pearl, hl('div.engine', [engineName(), hl('br'), i18n.site.inLocalBrowser])];

  return hl('div.ceval', { class: { enabled, computing } }, [renderCevalSwitch(ctrl), body, progressBar]);
}

// lila's cmnToggle: a checkbox styled as a switch.
// Trim: lila's input also loses the focus when clicked (blurIfPrimaryClick). Not in lila: the
// title, which lila passes but its switch doesn't show, shows when you point at it.
const renderCevalSwitch = (ctrl: AnalysisCtrl): VNode =>
  hl('span.cmn-toggle', { attrs: { role: 'button', title: i18n.site.toggleLocalEvaluation + ' (L)' } }, [
    hl('input#cmn-tg-analyse-toggle-ceval', {
      attrs: { type: 'checkbox', checked: ctrl.cevalEnabled() },
      props: { checked: ctrl.cevalEnabled() },
      on: { change: e => ctrl.cevalEnabled((e.target as HTMLInputElement).checked) },
    }),
    hl('label', { attrs: { for: 'cmn-tg-analyse-toggle-ceval' } }),
  ]);

// The engine's line. Clicking one of its moves plays the line up to it, as in lila.
export function renderPvs(ctrl: AnalysisCtrl): VNode | undefined {
  if (!ctrl.cevalEnabled()) return undefined;
  const node = ctrl.node;
  return hl(
    'div.pv_box',
    {
      attrs: { 'data-fen': node.fen },
      hook: onInsert(el =>
        el.addEventListener('pointerdown', (e: PointerEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest('.pv-wrap-toggle')) return;
          const ucis = [...el.querySelectorAll<HTMLElement>('.pv-san')].map(span => span.dataset.uci!);
          const index = Number(target.dataset.moveIndex ?? 0);
          if (ucis.length > index) {
            ctrl.playUciList(ucis.slice(0, index + 1));
            e.preventDefault();
          }
        }),
      ),
    },
    renderPv(node.ceval?.pv, positionOf(node)),
  );
}

const MAX_NUM_MOVES = 16;

function renderPv(pv: string[] | undefined, pos: Position): VNode {
  return hl('div.pv.pv--nowrap', pv ? { attrs: { 'data-uci': pv[0] } } : {}, [
    renderPvWrapToggle(),
    pv && renderPvMoves(pos, pv.slice(0, MAX_NUM_MOVES)),
  ]);
}

// Shows the whole line, wrapped, or only its first row.
function renderPvWrapToggle(): VNode {
  return hl('span.pv-wrap-toggle', {
    hook: onInsert(el => {
      for (const event of ['touchstart', 'mousedown']) {
        el.addEventListener(event, (e: Event) => {
          e.stopPropagation();
          e.preventDefault();
          el.closest('.pv')?.classList.toggle('pv--nowrap');
        });
      }
    }),
  });
}

// Trim: lila also keeps each move's position (data-board) for its small board.
function renderPvMoves(pos: Position, pv: string[]): VNode[] {
  const vnodes: VNode[] = [];
  for (let i = 0; i < pv.length; i++) {
    let text;
    if (pos.turn === 'white') text = `${pos.fullmoves}.`;
    else if (i === 0) text = `${pos.fullmoves}...`;
    if (text) vnodes.push(hl('span', { key: text }, text));
    const uci = pv[i];
    const move = parseUci(uci);
    if (!move) break;
    const san = makeSanAndPlay(pos, move);
    if (san === '--') break;
    vnodes.push(hl('span.pv-san', { key: `${i}|${uci}`, attrs: { 'data-move-index': i, 'data-uci': uci } }, san));
  }
  return vnodes;
}
