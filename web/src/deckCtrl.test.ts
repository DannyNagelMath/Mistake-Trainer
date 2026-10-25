// deckCtrl.test.ts: checks how DeckCtrl grades a card. A wrong first move, "View the solution",
// or "Skip" is Again at once; the right first move waits for you to choose Hard, Good, or Easy.
// Moves are played through the controller, the way the board plays them. Saving is stubbed out,
// so nothing is written anywhere, and Stockfish, which needs a browser, has a stand-in.
import { makeUci } from 'chessops';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import type { VNode } from 'snabbdom';
import { Rating } from 'ts-fsrs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import type { AnalysisCtrl } from './analysisCtrl';
import { compute as autoShapes } from './autoShape';
import { cardsOfGame, mistakeOf, type Card, type Deck } from './deck';
import { DeckCtrl } from './deckCtrl';
import { getBestEval } from './evalGauge';
import type { ReviewHistory } from './reviews';
import type { EngineEval } from './engine';
import { defaultSettings, type Settings } from './settings';
import { renderSide } from './side';
import type { LichessGameJson } from './tree';

// The stand-in for Stockfish (engine.ts). A move check reports each of `updates` as the search
// goes deeper, the last one as its final answer. Live analysis is noted in `analyses`, for the
// test to report on. vi.mock replaces the module for everything this file uses.
type Analysis = { fen: string; onInfo: (e: EngineEval) => void };
const engine = vi.hoisted(() => ({
  updates: [] as EngineEval[],
  asked: [] as string[],
  analyses: [] as Analysis[],
  stops: 0,
}));
vi.mock('./engine', () => ({
  evaluate: async (fen: string, onInfo: (e: EngineEval) => void) => {
    engine.asked.push(fen);
    engine.updates.slice(0, -1).forEach(onInfo);
    return engine.updates.at(-1)!;
  },
  analyse: (fen: string, onInfo: (e: EngineEval) => void) => engine.analyses.push({ fen, onInfo }),
  stopAnalysis: () => engine.stops++,
  isAnalysing: () => false,
  ANALYSIS_MILLIS: 8000,
  ENGINE_NAME: 'Stockfish',
}));

const game = real1 as unknown as LichessGameJson;
const deck: Deck = { username: 'mugglesman1982', builtAt: '', games: { [game.id]: game }, cards: cardsOfGame(game, 'white') };

let saved: unknown[]; // what the page sent to save
beforeEach(() => {
  saved = [];
  engine.updates = [];
  engine.asked = [];
  engine.analyses = [];
  engine.stops = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      saved.push(JSON.parse(init.body as string));
      return new Response(null, { status: 204 });
    }),
  );
  vi.stubGlobal('alert', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

// A session on an empty history, with the panel open on the first card, as main.ts does it.
function start(settings: Settings = defaultSettings) {
  const history: ReviewHistory = { cards: {}, log: [] };
  const deckCtrl = new DeckCtrl(deck, history, settings, () => {});
  const ctrl = deckCtrl.analysis;
  ctrl.toggleRetro();
  return { history, ctrl, retro: () => ctrl.retro!, deckCtrl };
}
const playSolution = (ctrl: AnalysisCtrl) => ctrl.playUci(ctrl.retro!.current()!.solution.node.uci!);
const playGameMove = (ctrl: AnalysisCtrl) => ctrl.playUci(ctrl.retro!.current()!.fault.node.uci!);

test('the right first move records nothing until you choose how it went', () => {
  const { history, ctrl, retro } = start();
  playSolution(ctrl);
  expect(retro().feedback()).toBe('win');
  expect(history.log).toHaveLength(0);
  const choices = retro().card!.ratingChoices();
  expect(choices?.map(c => c.label)).toEqual(['Worked it out', 'Looked familiar', 'Knew it instantly']);
  choices![0].rate();
  expect(history.log.map(e => [e.result, e.log.rating])).toEqual([['win', Rating.Hard]]);
  expect(retro().card!.ratingChoices()).toBeUndefined(); // graded: the panel offers Next again
  expect(saved).toHaveLength(1);
});

test('each button gives its rating: Hard, Good, Easy', () => {
  const ratings = [0, 1, 2].map(i => {
    const { history, ctrl, retro } = start();
    playSolution(ctrl);
    retro().card!.ratingChoices()![i].rate();
    return history.log[0].log.rating;
  });
  expect(ratings).toEqual([Rating.Hard, Rating.Good, Rating.Easy]);
});

test('a wrong first move is Again at once, and getting it right afterwards asks nothing', () => {
  const { history, ctrl, retro } = start();
  playGameMove(ctrl);
  expect(history.log.map(e => [e.result, e.log.rating])).toEqual([['fail', Rating.Again]]);
  playSolution(ctrl); // the board went back, so try again
  expect(retro().feedback()).toBe('win');
  expect(retro().card!.ratingChoices()).toBeUndefined();
  expect(history.log).toHaveLength(1);
});

test('"View the solution" and "Skip" are Again at once', () => {
  const viewed = start();
  viewed.retro().viewSolution();
  expect(viewed.history.log.map(e => [e.result, e.log.rating])).toEqual([['view', Rating.Again]]);
  const skipped = start();
  skipped.retro().skip();
  expect(skipped.history.log.map(e => [e.result, e.log.rating])).toEqual([['skip', Rating.Again]]);
});

test('moving on from a card you got right, without choosing, records Good', () => {
  const { history, ctrl, retro } = start();
  const first = history.log.length;
  playSolution(ctrl);
  retro().jumpToNext(); // e.g. after closing and reopening the panel, which hides the buttons
  expect(history.log.slice(first).map(e => [e.result, e.log.rating])).toEqual([['win', Rating.Good]]);
});

test('while solving, nothing after the position, and no evals, marks, or engine lines; all back once done', () => {
  const { ctrl, retro } = start();
  const position = retro().current()!.prev;
  const hidden = () => ({
    afterPosition: ctrl.visibleChildren(position.node).length,
    engineLines: ctrl.mainline.filter(n => ctrl.visibleChildren(n).some(c => c.comp)).length,
    eval: ctrl.allowedEval(ctrl.mainline[1]),
    marks: ctrl.showMoveGlyphs(),
  });
  expect(ctrl.hidingHints()).toBe(true);
  expect(hidden()).toEqual({ afterPosition: 0, engineLines: 0, eval: false, marks: false });

  ctrl.navigate.last(); // the End key
  expect(ctrl.path).toBe(position.path); // no further than the card's position

  playGameMove(ctrl); // wrong: still solving, still hidden
  expect(ctrl.hidingHints()).toBe(true);

  playSolution(ctrl); // right: the card is done
  expect(ctrl.hidingHints()).toBe(false);
  const shown = hidden();
  expect(shown.afterPosition).toBeGreaterThanOrEqual(2); // the game move and the engine's line
  expect(shown.engineLines).toBeGreaterThan(0);
  expect(shown.eval).toBeTruthy();
  expect(shown.marks).toBe(true);
});

// All the text in a rendered view, and whether it has an element with the given selector.
const textOf = (v: VNode | string | undefined): string =>
  typeof v === 'string' ? v : !v ? '' : (v.text ?? '') + (v.children ?? []).map(c => textOf(c as VNode)).join(' ');
const has = (v: VNode | string | undefined, sel: string): boolean =>
  typeof v === 'object' && !!v && (v.sel === sel || (v.children ?? []).some(c => has(c as VNode, sel)));

test("while solving, the side panel doesn't show the players or the date; once done, it does", () => {
  const { ctrl } = start();
  expect(textOf(renderSide(ctrl))).not.toContain('RealAgentCooper'); // the opponent
  expect(has(renderSide(ctrl), 'time.timeago')).toBe(false); // e.g. "2 years ago"
  playSolution(ctrl);
  expect(textOf(renderSide(ctrl))).toContain('RealAgentCooper');
  expect(has(renderSide(ctrl), 'time.timeago')).toBe(true);
});

test('suspending a card records no review, saves the suspension, and deals another card', () => {
  const { history, ctrl, retro } = start();
  const suspended = `${ctrl.game.id}/${retro().card!.ply}`;
  playSolution(ctrl); // right first time, and the rating is pending...
  retro().card!.suspend(); // ...but suspended instead
  expect(history.log).toHaveLength(0);
  expect(Object.keys(history.suspended ?? {})).toEqual([suspended]);
  expect(saved).toEqual([{ suspend: suspended, at: history.suspended![suspended] }]);
  expect(`${ctrl.game.id}/${ctrl.retro!.card!.ply}`).not.toBe(suspended); // another card
});

test('a wrong answer comes back after 7 days, not the next day', () => {
  const { history, ctrl } = start();
  playGameMove(ctrl);
  const [entry] = history.log;
  const gap = new Date(history.cards[entry.cardId].due).getTime() - new Date(entry.log.review).getTime();
  expect(gap).toBe(7 * 24 * 60 * 60_000);
});

test('the trainer uses your settings: here, a 3-day minimum gap', () => {
  const { history, ctrl } = start({ ...defaultSettings, minGapDays: 3 });
  playGameMove(ctrl);
  const [entry] = history.log;
  const gap = new Date(history.cards[entry.cardId].due).getTime() - new Date(entry.log.review).getTime();
  expect(gap).toBe(3 * 24 * 60 * 60_000);
});

// Every legal move in the position, in UCI.
const legalMoves = (fen: string): string[] => {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  return [...pos.allDests()].flatMap(([from, tos]) => [...tos].map(to => makeUci({ from, to })));
};

// A legal move at the card's position that is neither the game move nor the engine's best.
function otherMove(card: Card): string {
  const { fen, uci: played } = mistakeOf(game, card);
  return legalMoves(fen).find(m => m !== played && m !== game.analysis![card.ply - 1].best)!;
}

// A session on just this card, with the panel open on it.
function startOn(card: Card) {
  const history: ReviewHistory = { cards: {}, log: [] };
  const deckCtrl = new DeckCtrl({ ...deck, cards: [card] }, history, defaultSettings, () => {});
  deckCtrl.analysis.toggleRetro();
  return { history, ctrl: deckCtrl.analysis, feedback: () => deckCtrl.analysis.retro!.feedback() };
}
const afterTheEngine = () => new Promise(resolve => setTimeout(resolve, 0)); // its answer is a promise

// The first card is 20.Qh4??, which gave up a forced mate.
const evaluation = (score: { cp?: number; mate?: number }, nodes = 1_000_000): EngineEval => ({
  ...score,
  depth: 18,
  nodes,
  millis: 1500,
});

test("a move masters have played counts as a right answer at once, like the engine's, as in lila", () => {
  const [card] = deck.cards;
  const other = otherMove(card);
  const { ctrl, feedback } = startOn({ ...card, masterMoves: [other] });
  ctrl.playUci(other);
  expect(feedback()).toBe('win');
  expect(engine.asked).toEqual([]); // no need for Stockfish
});

test('any other move goes to Stockfish: right if within 0.08 winning chances of the best, as in lila', async () => {
  const [card] = deck.cards;
  const tryMove = async (answer: EngineEval) => {
    engine.updates = [answer];
    const session = startOn(card);
    session.ctrl.playUci(otherMove(card));
    const meanwhile = session.feedback();
    await afterTheEngine();
    return { meanwhile, then: session.feedback(), log: session.history.log };
  };
  const stillMates = await tryMove(evaluation({ mate: 4 }));
  expect(stillMates.meanwhile).toBe('eval'); // "Evaluating your move ..."
  expect(stillMates.then).toBe('win'); // then the rating buttons, as after the engine's move
  const onlyLevel = await tryMove(evaluation({ cp: 0 }));
  expect(onlyLevel.then).toBe('fail');
  expect(onlyLevel.log.map(e => [e.result, e.log.rating])).toEqual([['fail', Rating.Again]]);
});

test('the move is judged once Stockfish has searched enough: 1,000,000 positions, 3 seconds, or done', async () => {
  const [card] = deck.cards;
  engine.updates = [
    evaluation({ cp: 0 }, 300_000), // early in the search it looks bad, but that's too soon to say...
    evaluation({ mate: 4 }), // ...and after 1,000,000 positions it's fine
  ];
  const { ctrl, feedback } = startOn(card);
  ctrl.playUci(otherMove(card));
  expect(feedback()).toBe('eval');
  await afterTheEngine();
  expect(feedback()).toBe('win');
});

test("while solving, the board shows no annotations, not even the opponent's ??; once done, it does", () => {
  const [card] = deck.cards; // 20.Qh4??, just after Black's 19...Bg7??
  const { ctrl } = startOn(card);
  const annotated = () => autoShapes(ctrl).filter(s => s.customSvg).map(s => s.orig);
  expect(ctrl.node.glyphs?.map(g => g.symbol)).toEqual(['??']); // on the board, it would be a hint
  expect(annotated()).toEqual([]);
  playSolution(ctrl);
  ctrl.userJump(ctrl.retro!.current()!.prev.path); // back to the position, now that it's solved
  expect(annotated()).toEqual(['g7']);
  ctrl.settings.set('showMoveAnnotationsOnBoard', false); // the setting in the menu
  expect(annotated()).toEqual([]);
  ctrl.settings.set('showMoveAnnotationsOnBoard', true);
});

test("while solving, no evaluation and no best move arrows; once done, Lichess's, as lila draws them", () => {
  const [card] = deck.cards; // 20.Qh4?? when 20.Qxg7# was mate
  const { ctrl } = startOn(card);
  const arrows = () => autoShapes(ctrl).filter(s => s.dest).map(s => [s.brush, s.orig + s.dest]);
  expect(getBestEval(ctrl)).toBeUndefined(); // so the gauge has nothing to show
  expect(arrows()).toEqual([]);
  playSolution(ctrl);
  const { prev, fault } = ctrl.retro!.current()!;
  ctrl.userJump(prev.path); // the position you faced
  expect(getBestEval(ctrl)).toEqual(prev.node.eval);
  expect(arrows()).toEqual([
    ['paleGreen', 'd6f4'], // what Black should have played instead of 19...Bg7??, the move that led here
    ['paleBlue', 'h6g7'], // the best move from here, 20.Qxg7#
  ]);
  ctrl.userJump(fault.path); // after 20.Qh4
  expect(arrows()).toContainEqual(['paleGreen', 'h6g7']); // what should have been played instead
  ctrl.settings.set('showBestMoveArrows', false); // the setting in the menu
  expect(arrows()).toEqual([]);
  ctrl.settings.set('showBestMoveArrows', true);
});

test("the engine stays off while you're solving; once done, it analyses the position on the board", () => {
  const card = deck.cards[1]; // not the first card, whose solution is checkmate: nothing to analyse
  const { ctrl } = startOn(card);
  const blueArrows = () => autoShapes(ctrl).filter(s => s.brush === 'paleBlue').map(s => s.orig + s.dest);
  ctrl.cevalEnabled(true); // switching it on while solving does nothing
  expect(ctrl.cevalEnabled()).toBe(false);
  expect(engine.analyses).toEqual([]);
  playSolution(ctrl);
  expect(ctrl.cevalEnabled()).toBe(false); // still off once done: it wasn't switched on for later
  ctrl.cevalEnabled(true);
  expect(ctrl.cevalEnabled()).toBe(true);
  expect(engine.analyses.map(a => a.fen)).toEqual([ctrl.node.fen]); // the position after the solution
  engine.analyses[0].onInfo({ cp: 120, depth: 14, nodes: 500_000, millis: 1200, pv: ['a2a3', 'a7a6'] });
  expect(ctrl.node.ceval?.depth).toBe(14);
  expect(blueArrows()).toEqual(['a2a3']); // the engine's best move
  const stops = engine.stops;
  ctrl.cevalEnabled(false);
  expect(engine.stops).toBe(stops + 1);
});

test('coming back to the page shows the card you left, unless you had answered it', () => {
  const stored: Record<string, string> = {}; // a stand-in for the browser's sessionStorage
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => (stored[key] = value),
  });
  const history: ReviewHistory = { cards: {}, log: [] };
  const open = () => {
    const deckCtrl = new DeckCtrl(deck, history, defaultSettings, () => {});
    deckCtrl.analysis.toggleRetro();
    return deckCtrl.analysis;
  };
  const cardOn = (ctrl: AnalysisCtrl) => `${ctrl.game.id}/${ctrl.retro!.card!.ply}`;
  const left = deck.cards[2]; // not the card that would come up first
  stored['mistakeTrainer.card'] = left.id;
  const ctrl = open();
  expect(cardOn(ctrl)).toBe(left.id);
  expect(cardOn(open())).toBe(left.id); // and again
  playGameMove(ctrl); // answered
  expect(cardOn(open())).not.toBe(left.id);
});

test('leaving the page after the right first move, without rating it, records it as Good', () => {
  const { history, ctrl, deckCtrl } = start();
  deckCtrl.leave(); // nothing to record yet
  expect(history.log).toEqual([]);
  playSolution(ctrl);
  deckCtrl.leave();
  expect(history.log.map(e => [e.result, e.log.rating])).toEqual([['win', Rating.Good]]);
  expect(saved).toHaveLength(1);
  deckCtrl.leave(); // only once
  expect(history.log).toHaveLength(1);
});

test("once a card is done, the game's other mistakes, other cards, keep their analysis hidden, and say so", () => {
  const { ctrl } = start();
  playSolution(ctrl);
  const moveList = textOf(ctrl.treeView.render());
  expect(moveList).toContain('Another card: its analysis stays hidden');
  expect(moveList).not.toContain('Learn from this mistake'); // lila's words, for a whole game
});
