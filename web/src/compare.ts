// compare.ts: Not in lila. The comparison page (compare.html, compareView.ts): it analyses the games
// Lichess has analysed again, on your computer (a run of analyses, analysisRun.ts), to see how the
// cards from each analysis compare.

import type { Color } from 'chessops';

import type { SavedAnalysis } from './analyses';
import { AnalysisRun } from './analysisRun';
import { cardsOfGame, colorOf, inOpening, mistakeOf, withMasterMoves, type Card, type MasterMove } from './deck';
import { buildTree, mainline, type LichessAnalysisEntry, type LichessGameJson } from './tree';

// ---------- Comparing a game ----------

// A card either analysis gives, for one of your moves (ply). A mistake in the opening goes to the
// masters database, the same for both analyses (deck.ts withMasterMoves): if masters played it, it's
// a book move, and neither keeps the card; if it hasn't been looked up yet, that's still unknown.
export interface CardRow {
  ply: number;
  move: string; // e.g. "20. Qh4" or "15... Rf8"
  lichess: boolean;
  local: boolean;
  masters?: 'book' | 'unknown';
}

export interface Judgments {
  same: number;
  different: number; // both judged the move, but not alike (e.g. a mistake and a blunder)
  lichessOnly: number;
  localOnly: number;
}

export interface GameComparison {
  game: LichessGameJson;
  color: Color;
  cards: CardRow[];
  judgments: Judgments; // of both players' moves
  evalDifferences: number[]; // in centipawns, for each position both evaluate in centipawns
}

export function compareGame(
  game: LichessGameJson,
  local: LichessAnalysisEntry[],
  color: Color,
  masters: Record<string, MasterMove[]>,
): GameComparison {
  const lichessCards = cardsOfGame(game, color);
  const localCards = cardsOfGame({ ...game, analysis: local }, color);
  const line = mainline(buildTree(game));
  const cards = [...lichessCards, ...localCards.filter(c => !lichessCards.some(l => l.ply === c.ply))]
    .sort((a, b) => a.ply - b.ply)
    .map(card => ({
      ply: card.ply,
      move: moveName(line.find(n => n.ply === card.ply)!),
      lichess: lichessCards.some(c => c.ply === card.ply),
      local: localCards.some(c => c.ply === card.ply),
      masters: mastersVerdict(game, card, masters),
    }));

  const lichess = game.analysis ?? [];
  const judgments: Judgments = { same: 0, different: 0, lichessOnly: 0, localOnly: 0 };
  const evalDifferences: number[] = [];
  for (let i = 0; i < Math.max(lichess.length, local.length); i++) {
    const [theirs, ours] = [lichess[i], local[i]];
    if (theirs?.judgment && ours?.judgment) judgments[theirs.judgment.name === ours.judgment.name ? 'same' : 'different']++;
    else if (theirs?.judgment) judgments.lichessOnly++;
    else if (ours?.judgment) judgments.localOnly++;
    if (theirs?.eval !== undefined && ours?.eval !== undefined) evalDifferences.push(Math.abs(theirs.eval - ours.eval));
  }
  return { game, color, cards, judgments, evalDifferences };
}

const moveName = (node: { ply: number; san?: string }): string =>
  `${Math.ceil(node.ply / 2)}${node.ply % 2 === 1 ? '.' : '...'} ${node.san}`;

function mastersVerdict(game: LichessGameJson, card: Card, masters: Record<string, MasterMove[]>): CardRow['masters'] {
  if (!inOpening(game, card)) return undefined;
  const mistake = mistakeOf(game, card);
  const moves = masters[mistake.fen];
  if (!moves) return 'unknown';
  return withMasterMoves(card, mistake, moves) ? undefined : 'book';
}

// ---------- All the games compared so far ----------

export interface Totals {
  // Cards: book moves don't count as either analysis's; unknown ones count, and are counted again.
  cards: { same: number; lichessOnly: number; localOnly: number; book: number; unknown: number };
  judgments: Judgments;
  evalDifferences: number[]; // sorted
}

export function totals(comparisons: GameComparison[]): Totals {
  const t: Totals = {
    cards: { same: 0, lichessOnly: 0, localOnly: 0, book: 0, unknown: 0 },
    judgments: { same: 0, different: 0, lichessOnly: 0, localOnly: 0 },
    evalDifferences: [],
  };
  for (const c of comparisons) {
    for (const row of c.cards) {
      if (row.masters === 'book') t.cards.book++;
      else t.cards[row.lichess && row.local ? 'same' : row.lichess ? 'lichessOnly' : 'localOnly']++;
      if (row.masters === 'unknown') t.cards.unknown++;
    }
    for (const key of Object.keys(t.judgments) as (keyof Judgments)[]) t.judgments[key] += c.judgments[key];
    t.evalDifferences.push(...c.evalDifferences);
  }
  t.evalDifferences.sort((a, b) => a - b);
  return t;
}

// ---------- The page ----------

// The comparison page's run of analyses (analysisRun.ts), on the games you played that Lichess has
// analysed, and how they compare.
export class CompareCtrl extends AnalysisRun {
  private readonly compared = new Map<string, GameComparison>();

  constructor(
    readonly username: string,
    games: LichessGameJson[], // the games you played that Lichess analysed
    saved: Record<string, SavedAnalysis>, // the analyses made here, by game
    readonly masters: Record<string, MasterMove[]>,
    redraw: () => void,
  ) {
    super(games, saved, redraw);
  }

  // The games analysed here so far, compared with Lichess's analysis.
  comparisons = (): GameComparison[] =>
    this.games
      .filter(g => this.saved[g.id])
      .map(g => {
        let c = this.compared.get(g.id);
        if (!c) this.compared.set(g.id, (c = compareGame(g, this.saved[g.id].analysis, colorOf(g, this.username)!, this.masters)));
        return c;
      });
}
