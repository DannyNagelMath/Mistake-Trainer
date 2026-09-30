// roundTraining.ts: Step 8. Under the controls: each player's inaccuracies, mistakes, and blunders,
// and their average centipawn loss, with the "Learn from your mistakes" button between them.
// Clicking a count jumps to the next such move. From lila's ui/analyse/src/view/roundTraining.ts
// (master, commit 27ffc8b). Every change from lila's version is marked with a comment starting "Trim:".

import type { Color } from 'chessops';
import { h, thunk, type VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { i18n } from './i18n';
import { licon } from './licon';
import { ratingDiff } from './side';
import { bind, onInsert } from './snabbdom';
import type { LichessPlayer } from './tree';

type AdviceKind = 'inaccuracy' | 'mistake' | 'blunder';

interface Advice {
  kind: AdviceKind;
  i18n: typeof i18n.site.numberBlunders;
  symbol: string;
}

type AnalysisSide = NonNullable<LichessPlayer['analysis']>;

// Trim: lila's also names players of a study chapter from its tags.
const renderPlayer = (player: LichessPlayer): VNode => {
  if (player.user)
    return h('a.user-link.ulpt', { attrs: { href: `https://lichess.org/@/${player.user.name}`, target: '_blank' } }, [
      player.user.name,
      ' ',
      player.ratingDiff !== undefined ? ratingDiff(player.ratingDiff) : '',
    ]);
  return h('span', (player.aiLevel && 'Stockfish level ' + player.aiLevel) || 'Anonymous');
};

const advices: Advice[] = [
  { kind: 'inaccuracy', i18n: i18n.site.numberInaccuracies, symbol: '?!' },
  { kind: 'mistake', i18n: i18n.site.numberMistakes, symbol: '?' },
  { kind: 'blunder', i18n: i18n.site.numberBlunders, symbol: '??' },
];

function playerTable(ctrl: AnalysisCtrl, color: Color): VNode {
  const player = ctrl.game.players![color];
  const sideData = player.analysis!;

  return h('div.advice-summary__side', [
    h('div.advice-summary__player', [h(`icon.is.color-icon.${color}.text`), renderPlayer(player)]),
    h('div.advice-summary__sections', [
      h('div.advice-summary__acpl', [
        ...advices.map(a => error(sideData[a.kind], color, a)),
        h('div', [h('strong', sideData.acpl), h('span', ` ${i18n.site.averageCentipawnLoss}`)]),
      ]),
      // Trim: lila also shows accuracy by game phase. The game export has no phases, and only
      // has accuracy when asked for it (accuracy=true).
      sideData.accuracy !== undefined ? h('div.advice-summary__accuracy', renderAccuracy(sideData)) : '',
    ]),
  ]);
}

const renderAccuracy = (side: AnalysisSide): VNode[] => [
  h(`div.advice-summary__phase`, [h('strong', [side.accuracy!, '%']), h('span', i18n.site.accuracy)]),
];

const error = (nb: number, color: Color, advice: Advice) =>
  h(
    'div.advice-summary__error' + (nb ? `.symbol.${advice.kind}` : ''),
    { attrs: nb ? { 'data-color': color, 'data-symbol': advice.symbol } : {} },
    advice.i18n.asArray(nb, h('strong', nb)),
  );

const doRender = (ctrl: AnalysisCtrl): VNode => {
  return h(
    'div.advice-summary',
    {
      hook: onInsert(elem => {
        // Trim: lila uses jQuery's $(elem).on('click', 'div.symbol', ...) for this.
        elem.addEventListener('click', e => {
          const symbol = (e.target as HTMLElement).closest<HTMLElement>('div.symbol');
          if (symbol) ctrl.jumpToGlyphSymbol(symbol.dataset.color as Color, symbol.dataset.symbol!);
        });
      }),
    },
    [
      playerTable(ctrl, 'white'),
      h(
        'a.button.text',
        {
          class: { active: !!ctrl.retro },
          attrs: { 'data-icon': licon.PlayTriangle },
          hook: bind('click', ctrl.toggleRetro, ctrl.redraw),
        },
        i18n.site.learnFromYourMistakes,
      ),
      playerTable(ctrl, 'black'),
    ],
  );
};

// Trim: lila also links a recommended puzzle theme here, and shows this in studies' analysis tab.
export function render(ctrl: AnalysisCtrl): VNode | undefined {
  const players = ctrl.game.players;
  if (!players?.white.analysis || !players.black.analysis || !ctrl.settings.showStaticAnalysis)
    return h('div.analyse__round-training');

  // thunk only renders the summary again when the key changes. Step 9: the key includes
  // cgVersion, which changes when a card loads another game.
  const cacheKey = String(!!ctrl.retro) + ctrl.cgVersion;

  return h('div.analyse__round-training', [h('div.analyse__acpl', thunk('div.advice-summary', doRender, [ctrl, cacheKey]))]);
}
