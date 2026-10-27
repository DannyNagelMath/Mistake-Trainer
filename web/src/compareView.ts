// compareView.ts: Not in lila. Draws the comparison page (compare.ts): the run, and how Lichess's
// analysis and ours compare, in all and game by game.

import type { VNode } from 'snabbdom';

import { renderRun } from './analysisRunView';
import { totals, type CardRow, type CompareCtrl, type GameComparison, type Totals } from './compare';
import { ENGINE_NAME, engineCount, GAME_NODES } from './fishnet';
import { hl, type LooseVNodes } from './snabbdom';

export function view(ctrl: CompareCtrl): VNode {
  const comparisons = ctrl.comparisons();
  return hl('main.page-small.box.box-pad.mt-compare-page', [
    hl('h1.box__top', "Lichess's analysis and ours"),
    hl(
      'p',
      `Your ${ctrl.games.length} games that Lichess has analysed, analysed again here the way Lichess's servers ` +
        `do it (${ENGINE_NAME}, ${GAME_NODES.toLocaleString('en')} positions per move, in fishnet's batches, on ` +
        `${engineCount()} engines side by side, one thread each), to compare the cards each ` +
        'analysis gives. Each game is saved once it’s done, so you can pause, or close this page, and carry on later.',
    ),
    renderRun(ctrl),
    comparisons.length > 0 && [renderTotals(totals(comparisons)), renderGames(comparisons)],
  ]);
}

function renderTotals(t: Totals): VNode {
  const d = t.evalDifferences;
  const median = d.length ? d[Math.floor(d.length / 2)] : 0;
  const withinHalfAPawn = d.length ? Math.round((100 * d.filter(x => x <= 50).length) / d.length) : 0;
  const j = t.judgments;
  return hl('section', [
    hl('h2', 'So far'),
    hl(
      'p',
      `Cards: ${t.cards.same} the same, ${t.cards.lichessOnly} only from Lichess's analysis, ` +
        `${t.cards.localOnly} only from ours.`,
    ),
    t.cards.book > 0 && hl('p', `${t.cards.book} more were book moves (masters played them), which neither keeps.`),
    t.cards.unknown > 0 &&
      hl(
        'p',
        `${t.cards.unknown} of these cards are opening mistakes the masters database hasn't been asked about yet, ` +
          'marked (?): some may turn out to be book moves.',
      ),
    hl(
      'p',
      `Judgments of both players' moves: ${j.same} the same, ${j.different} rated differently, ` +
        `${j.lichessOnly} only Lichess's, ${j.localOnly} only ours.`,
    ),
    hl(
      'p',
      `Evaluations: half are within ${(median / 100).toFixed(2)} pawns of Lichess's, and ${withinHalfAPawn}% ` +
        'within half a pawn.',
    ),
  ]);
}

// Games whose cards differ come first. Each card links to its position on Lichess, which shows
// Lichess's analysis of it.
function renderGames(comparisons: GameComparison[]): VNode {
  const differing = (c: GameComparison) => c.cards.filter(r => r.masters !== 'book' && r.lichess !== r.local).length;
  const sorted = [...comparisons].sort((a, b) => differing(b) - differing(a));
  return hl('section', [
    hl('h2', 'Game by game'),
    hl('table', [
      hl('thead', hl('tr', [hl('th', 'Game'), hl('th', 'Same cards'), hl('th', "Only Lichess's"), hl('th', 'Only ours')])),
      hl(
        'tbody',
        sorted.map(c =>
          hl('tr', { class: { 'mt-compare__differs': differing(c) > 0 } }, [
            hl('td', [
              hl('a', { attrs: { href: lichessUrl(c), target: '_blank', rel: 'noopener' } }, c.game.id),
              c.game.createdAt && [hl('br'), new Date(c.game.createdAt).toLocaleDateString()],
            ]),
            hl('td', cardList(c, r => r.lichess && r.local)),
            hl('td', cardList(c, r => r.lichess && !r.local)),
            hl('td', cardList(c, r => !r.lichess && r.local)),
          ]),
        ),
      ),
    ]),
  ]);
}

// The game on Lichess, from your side, at the position before a move.
const lichessUrl = (c: GameComparison, ply?: number): string =>
  `https://lichess.org/${c.game.id}/${c.color}` + (ply ? `#${ply - 1}` : '');

function cardList(c: GameComparison, which: (row: CardRow) => boolean): LooseVNodes {
  return c.cards.filter(which).map((row, i) => [
    i > 0 && ', ',
    hl(
      'a',
      {
        class: { 'mt-compare__book': row.masters === 'book' },
        attrs: {
          href: lichessUrl(c, row.ply),
          target: '_blank',
          rel: 'noopener',
          title:
            row.masters === 'book'
              ? 'A book move: masters played it, so neither analysis keeps this card.'
              : row.masters === 'unknown'
                ? "An opening mistake the masters database hasn't been asked about yet."
                : 'This position on Lichess',
        },
      },
      row.move + (row.masters === 'unknown' ? ' (?)' : ''),
    ),
  ]);
}
