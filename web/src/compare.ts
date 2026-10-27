// compare.ts: Not in lila. The comparison page (compare.html, compareView.ts): it analyses the games
// Lichess has analysed again, on your computer (localAnalysis.ts), to see how the cards from each
// analysis compare. Each game's analysis is saved as soon as it's done (analyses.ts), so a run can
// be paused, or the page closed, and taken up again later.

import type { Color } from 'chessops';

import { saveAnalysis, type SavedAnalysis } from './analyses';
import { cardsOfGame, colorOf, inOpening, mistakeOf, withMasterMoves, type Card, type MasterMove } from './deck';
import { ENGINE_NAME, GAME_NODES } from './engine';
import { analyseGame } from './localAnalysis';
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

// ---------- Running the analyses ----------

const positionsOf = (game: LichessGameJson): number => game.moves.split(' ').filter(san => san !== '').length + 1;

export class CompareCtrl {
  running = false;
  pausing = false; // pause was pressed: the run stops once the position being searched is done
  current?: { game: LichessGameJson; done: number; total: number }; // the game being analysed
  failed: Record<string, string> = {}; // games that couldn't be analysed, with why, this time
  error = ''; // why the run stopped, if not paused or finished
  private abort?: AbortController;
  private startedAt = 0; // when this run started (performance.now)
  private positionsDone = 0; // in this run
  private readonly compared = new Map<string, GameComparison>();

  constructor(
    readonly username: string,
    readonly games: LichessGameJson[], // the games you played that Lichess analysed
    readonly saved: Record<string, SavedAnalysis>, // the analyses made here, by game
    readonly masters: Record<string, MasterMove[]>,
    private readonly redraw: () => void,
  ) {}

  waiting = (): LichessGameJson[] => this.games.filter(g => !this.saved[g.id] && !this.failed[g.id]);

  // Analyses each game that hasn't been analysed here yet, and saves it, until all are done or the
  // run is paused.
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
    this.running = this.pausing = false;
    this.current = undefined;
    this.redraw();
  };

  // Stops the run once the position being searched is done. That game's analysis isn't saved, as
  // it isn't finished: it starts again from its last position next time.
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
