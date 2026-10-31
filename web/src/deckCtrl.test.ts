// deckCtrl.test.ts: checks how DeckCtrl grades a card. A wrong first move, "View the solution",
// or "Skip" is Again at once; the right first move waits for you to choose Hard, Good, or Easy.
// Moves are played through the controller, the way the board plays them. Saving is stubbed out,
// so nothing is written anywhere, and Stockfish, which needs a browser, has a stand-in.
import { makeUci } from 'chessops';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSquare } from 'chessops/util';
import type { VNode } from 'snabbdom';
import { createEmptyCard, Rating, State } from 'ts-fsrs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import type { AnalysisCtrl } from './analysisCtrl';
import { compute as autoShapes } from './autoShape';
import { renderCeval } from './cevalView';
import { cardsOfGame, mistakeOf, type Card, type Deck, type MasterMove } from './deck';
import { DeckCtrl } from './deckCtrl';
import { DeckUpdateCtrl } from './deckUpdate';
import { getBestEval } from './evalGauge';
import { detectCheckable, detectPins, detectUndefended } from './motif';
import type { ReviewHistory } from './reviews';
import { renderProgress } from './progressView';
import renderRetro from './retroView';
import { renderStats } from './statsView';
import type { EngineEval } from './engine';
import { defaultSettings, type Settings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view as trainingSettingsView } from './settingsPageView';
import { renderSide } from './side';
import renderClocks from './clocks';
import type { LichessGameJson } from './tree';
import { YourGamesCtrl } from './yourGames';

// The stand-in for Stockfish (engine.ts). A move check reports each of `byFen[fen]` (or else
// `updates`) as the search goes deeper, the last one as its final answer. Live analysis is noted
// in `analyses`, for the test to report on. vi.mock replaces the module for everything this file
// uses.
type Analysis = { fen: string; onInfo: (e: EngineEval) => void };
const engine = vi.hoisted(() => ({
  updates: [] as EngineEval[],
  byFen: {} as Record<string, EngineEval[]>,
  asked: [] as string[],
  analyses: [] as Analysis[],
  stops: 0,
}));
vi.mock('./engine', () => ({
  evaluate: async (fen: string, onInfo: (e: EngineEval) => void) => {
    engine.asked.push(fen);
    const updates = engine.byFen[fen] ?? engine.updates;
    updates.slice(0, -1).forEach(onInfo);
    return updates.at(-1)!;
  },
  analyse: (fen: string, onInfo: (e: EngineEval) => void) => engine.analyses.push({ fen, onInfo }),
  stopAnalysis: () => engine.stops++,
  isAnalysing: () => false,
  ANALYSIS_MILLIS: 8000,
  ENGINE_NAME: 'Stockfish',
  FULL_NETWORK: true,
  MULTI_THREADED: false,
}));

const game = real1 as unknown as LichessGameJson;
const deck: Deck = { username: 'mugglesman1982', builtAt: '', games: { [game.id]: game }, cards: cardsOfGame(game, 'white') };

let saved: unknown[]; // what the page sent to save
beforeEach(() => {
  saved = [];
  engine.updates = [];
  engine.byFen = {};
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers(); // after a test that set the date
});

// A stand-in for the browser's localStorage or sessionStorage, keeping what's stored in `stored`.
const standIn = (stored: Record<string, string>) => ({
  getItem: (key: string) => stored[key] ?? null,
  setItem: (key: string, value: string) => (stored[key] = value),
  removeItem: (key: string) => delete stored[key],
});

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

test('each review saves the move you played first, right or wrong; "View the solution" and "Skip" have none', () => {
  const right = start();
  const solution = right.retro().current()!.solution.node;
  playSolution(right.ctrl);
  right.retro().card!.ratingChoices()![1].rate();
  expect(right.history.log[0].move).toEqual({ san: solution.san, uci: solution.uci });
  expect((saved.at(-1) as { entry: object }).entry).toMatchObject({ move: { san: solution.san } }); // and it's saved

  const wrong = start();
  const gameMove = wrong.retro().current()!.fault.node;
  playGameMove(wrong.ctrl);
  playSolution(wrong.ctrl); // right on the second try: the review is the first
  expect(wrong.history.log.map(e => e.move)).toEqual([{ san: gameMove.san, uci: gameMove.uci }]);

  const later = start();
  const laterSolution = later.retro().current()!.solution.node;
  playSolution(later.ctrl);
  later.retro().jumpToNext(); // not rated: recorded as Good, with the move
  expect(later.history.log[0].move).toEqual({ san: laterSolution.san, uci: laterSolution.uci });

  const viewed = start();
  viewed.retro().viewSolution();
  const skipped = start();
  skipped.retro().skip();
  expect([viewed.history.log[0].move, skipped.history.log[0].move]).toEqual([undefined, undefined]);
});

// A first session on Oct 12, 2026, at noon, which does `firstTry` on its card; then another on
// `back`, by when the card is due again, with the panel open on it.
function comeBack(firstTry: (ctrl: AnalysisCtrl, history: ReviewHistory) => void, back = new Date(2026, 9, 20, 12)) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 12, 12));
  const first = start();
  const { fault, solution } = first.retro().current()!;
  firstTry(first.ctrl, first.history);
  if (first.retro().card!.ratingChoices()) first.retro().card!.ratingChoices()![0].rate();
  vi.setSystemTime(back);
  const deckCtrl = new DeckCtrl(deck, first.history, defaultSettings, () => {});
  const ctrl = deckCtrl.analysis;
  ctrl.toggleRetro();
  expect(ctrl.retro!.card!.ply).toBe(fault.node.ply); // the same card
  const note = () => textOf(find(renderRetro(ctrl), 'div.mt-last-time')).trim();
  return { ctrl, history: first.history, gameMove: fault.node.san!, best: solution.node.san!, note };
}

test("a card that comes back says how you did last time, once you've answered, and not before", () => {
  const { ctrl, gameMove, note } = comeBack(playGameMove);
  expect(note()).toBe(''); // while you look for the move
  playGameMove(ctrl);
  expect(ctrl.retro!.feedback()).toBe('fail');
  expect(note()).toBe(''); // still looking
  playSolution(ctrl);
  expect(note()).toBe(`Last time (Oct 12): wrong, you played ${gameMove}, the game’s move.`);
});

test('after the right move last time, the note says so, with the move; it shows with the solution too', () => {
  const { ctrl, best, note } = comeBack(playSolution);
  ctrl.retro!.viewSolution();
  expect(ctrl.retro!.feedback()).toBe('view');
  expect(note()).toBe(`Last time (Oct 12): right, with ${best}.`);
});

test('for a review from before the move was saved, the note says right or wrong; the year, if it was another', () => {
  const { ctrl, note } = comeBack((ctrl, history) => {
    playGameMove(ctrl);
    delete history.log[0].move; // as in the reviews saved so far
  }, new Date(2027, 0, 5, 12));
  playSolution(ctrl);
  expect(note()).toBe('Last time (Oct 12, 2026): wrong.');
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
// The first element with the given selector, and a click on it, which returns what its handler does.
const find = (v: VNode | string | undefined, sel: string): VNode | undefined =>
  typeof v !== 'object' || !v ? undefined : v.sel === sel ? v : (v.children ?? []).map(c => find(c as VNode, sel)).find(Boolean);
const click = (v: VNode | undefined): unknown => (v!.data!.on!.click as () => unknown)();

test("while solving, the side panel doesn't show the players or the date; once done, it does", () => {
  const { ctrl } = start();
  expect(textOf(renderSide(ctrl))).not.toContain('RealAgentCooper'); // the opponent
  expect(has(renderSide(ctrl), 'time.timeago')).toBe(false); // e.g. "2 years ago"
  playSolution(ctrl);
  expect(textOf(renderSide(ctrl))).toContain('RealAgentCooper');
  expect(has(renderSide(ctrl), 'time.timeago')).toBe(true);
});

// The deck's game, as if Lichess hadn't analysed it and its analysis had been made here instead.
const analysedHere: LichessGameJson = { ...game, analysedHere: { engine: 'Stockfish 19', nodes: 1_000_000, at: '' } };

test('the side panel says where the computer analysis came from: Lichess, or your computer', () => {
  expect(textOf(renderSide(start().ctrl))).toContain('Computer analysis by Lichess');
  const deckCtrl = new DeckCtrl({ ...deck, games: { [game.id]: analysedHere } }, { cards: {}, log: [] }, defaultSettings, () => {});
  deckCtrl.analysis.toggleRetro();
  expect(textOf(renderSide(deckCtrl.analysis))).toContain(
    'Computer analysis made on your computer: Lichess hasn’t analysed this game',
  );
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

test('a wrong answer comes back after 5 days, not the next day', () => {
  const { history, ctrl } = start();
  playGameMove(ctrl);
  const [entry] = history.log;
  const gap = new Date(history.cards[entry.cardId].due).getTime() - new Date(entry.log.review).getTime();
  expect(gap).toBe(5 * 24 * 60 * 60_000);
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

test("any other move goes to Stockfish: right if within 0.08 winning chances of its eval of the position before", async () => {
  const [card] = deck.cards;
  engine.byFen[mistakeOf(game, card).fen] = [evaluation({ mate: 3 })]; // the position you faced
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
  engine.byFen[mistakeOf(game, card).fen] = [evaluation({ mate: 3 })];
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
    ['variation', 'h6h4'], // and with two moves from here now, an arrow for the game's (variation arrows)
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

test("until the engine has a result, its bar says the evaluation is the game's analysis: the server's, or for a game analysed here, the computer analysis", () => {
  const solved = (g: LichessGameJson) => {
    const deckCtrl = new DeckCtrl({ ...deck, games: { [game.id]: g }, cards: [deck.cards[0]] }, { cards: {}, log: [] }, defaultSettings, () => {});
    const ctrl = deckCtrl.analysis;
    ctrl.toggleRetro();
    playSolution(ctrl);
    ctrl.cevalEnabled(true);
    ctrl.userJump(ctrl.retro!.current()!.prev.path); // the position you faced, which the analysis has a best move for
    return ctrl;
  };
  for (const [g, says] of [
    [game, 'Using server analysis'],
    [analysedHere, 'Using computer analysis'],
  ] as const) {
    const ctrl = solved(g);
    expect(ctrl.node.ceval).toBeUndefined(); // the engine hasn't answered yet
    expect(textOf(renderCeval(ctrl))).toContain(says);
    ctrl.cevalEnabled(false); // as it was, for the other tests
  }
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

test('coming back after the right first move, before rating it, shows the card solved, with the rating buttons', () => {
  vi.stubGlobal('localStorage', standIn({}));
  vi.stubGlobal('sessionStorage', standIn({}));
  const history: ReviewHistory = { cards: {}, log: [] };
  const open = () => {
    const deckCtrl = new DeckCtrl(deck, history, defaultSettings, () => {});
    deckCtrl.analysis.toggleRetro();
    deckCtrl.resume(); // as main.ts does
    return deckCtrl.analysis;
  };
  const first = open();
  const card = `${first.game.id}/${first.retro!.card!.ply}`;
  playSolution(first); // right, and the rating buttons show...
  const back = open(); // ...but you reloaded the page, or closed it and came back
  expect(`${back.game.id}/${back.retro!.card!.ply}`).toBe(card);
  expect(back.retro!.feedback()).toBe('win');
  expect(history.log).toEqual([]); // nothing recorded yet
  back.retro!.card!.ratingChoices()![2].rate(); // "Knew it instantly"
  expect(history.log.map(e => [e.cardId, e.result, e.log.rating])).toEqual([[card, 'win', Rating.Easy]]);
  const later = open(); // rated: the card doesn't come back
  expect(later.retro!.current()?.fault.node.ply).not.toBe(first.retro!.card!.ply);
});

// Training settings shows over the trainer (main.ts), with the trainer's history, and passes on
// the settings you save. Here, the computer analysis of your games hasn't loaded (yourGames.test.ts
// tries it), and the dev server hasn't been asked about "Update deck" (deckUpdate.test.ts does).
const notLoaded = () => new YourGamesCtrl(deck.username, () => defaultSettings.gameTypes, () => {});
const noUpdate = () => new DeckUpdateCtrl(deck.username, () => defaultSettings.gameTypes, () => {});
const trainingSettings = (deckCtrl: DeckCtrl, history: ReviewHistory) =>
  new SettingsPageCtrl(deck, history, deckCtrl.settings, () => {}, deckCtrl.useSettings, notLoaded(), noUpdate());

test('saving Training settings in the middle of a card leaves it as it was, and "Right answers" applies to your next move', async () => {
  const { history, ctrl, deckCtrl } = start();
  const card = deck.cards.find(c => c.ply === ctrl.retro!.card!.ply)!;
  const onScreen = () => [card.id, ctrl.path, ctrl.retro!.feedback()];
  const before = onScreen();
  const page = trainingSettings(deckCtrl, history);
  page.update({ ...page.draft, bestMoveOnly: true });
  await page.save();
  expect(saved).toEqual([{ ...defaultSettings, bestMoveOnly: true }]); // to data/settings.json
  expect(onScreen()).toEqual(before);
  ctrl.playUci(otherMove(card));
  expect(ctrl.retro!.feedback()).toBe('fail'); // only the analysis's best move counts now...
  expect(engine.asked).toEqual([]); // ...so the engine isn't asked
});

test('saving Training settings after a card: the next card is dealt with them', async () => {
  const { history, ctrl, deckCtrl } = start();
  playGameMove(ctrl); // wrong: the card is done
  // All the deck's cards are from one game, so with the default settings the others wait a day.
  expect(deckCtrl.next()).toBe(false);
  const page = trainingSettings(deckCtrl, history);
  page.update({ ...page.draft, gameRestDays: 0 });
  await page.save();
  expect(deckCtrl.next()).toBe(true);
});

test("a suspended card's board opens a closer look: your move, what Lichess's analysis said, and the game on Lichess", async () => {
  const [card] = deck.cards; // 20.Qh4??, when 20.Qxg7+ led to mate
  const history: ReviewHistory = { cards: {}, log: [], suspended: { [card.id]: new Date().toISOString() } };
  const page = new SettingsPageCtrl(deck, history, defaultSettings, () => {}, () => {}, notLoaded(), noUpdate());
  const look = () => find(trainingSettingsView(page), 'dialog.mt-look');
  expect(look()).toBeUndefined();
  click(find(trainingSettingsView(page), 'button.mt-suspended__look'));
  const text = textOf(look());
  expect(text).toContain('Qh4');
  expect(text).toContain('(#3 → −2.1)'); // Lichess's evaluations, before and after it
  expect(text).toContain('Lost forced checkmate sequence. Qxg7+ was best.');
  expect(text).toContain('You had 0:39 left on your clock.');
  expect(text).toContain('Computer analysis by Lichess');
  expect(find(look(), 'a.button.button-empty')!.data!.attrs!.href).toBe(`https://lichess.org/${game.id}/white#38`);
  (look()!.data!.on!.close as () => void)(); // Escape, the close button, or a click outside it
  expect(look()).toBeUndefined();
  click(find(trainingSettingsView(page), 'button.mt-suspended__look'));
  await click(find(look(), 'button.button.button-empty')); // Unsuspend
  expect(saved).toEqual([{ unsuspend: card.id }]);
  expect(history.suspended).toEqual({});
  expect(look()).toBeUndefined(); // it's no longer one to look at
});

test("for a game analysed here, the closer look says so, and that Lichess hasn't analysed it", () => {
  const [card] = deck.cards;
  const history: ReviewHistory = { cards: {}, log: [], suspended: { [card.id]: new Date().toISOString() } };
  const here: Deck = { ...deck, games: { [game.id]: analysedHere } };
  const page = new SettingsPageCtrl(here, history, defaultSettings, () => {}, () => {}, notLoaded(), noUpdate());
  click(find(trainingSettingsView(page), 'button.mt-suspended__look'));
  const look = find(trainingSettingsView(page), 'dialog.mt-look');
  expect(textOf(look)).toContain('Computer analysis made on your computer: Lichess hasn’t analysed this game');
  expect(find(look, 'a.button.button-empty')!.data!.attrs!.title).toBe(
    'Opens the game on Lichess, at this position, in a new tab. Lichess hasn’t analysed this game: this ' +
      'analysis was made on your computer.',
  );
});

test("once a card is done, the game's analysis all shows, at its other mistakes, other cards, too", () => {
  const { ctrl } = start();
  playSolution(ctrl);
  const moveList = textOf(ctrl.treeView.render());
  const done = ctrl.retro!.current()!;
  const others = deck.cards.filter(c => c.ply !== done.fault.node.ply);
  expect(others).not.toEqual([]);
  for (const other of others) {
    const mistake = ctrl.mainline.find(n => n.ply === other.ply)!;
    expect(moveList).toContain(mistake.comments!.find(c => c.by === 'lichess')!.text); // e.g. "Blunder. Qxb4 was best."
  }
  expect(moveList).not.toContain('Learn from this mistake'); // lila's words for a mistake its review hasn't got to yet
});

test("once a card is done, the best move arrows show everywhere, around the game's other mistakes too", () => {
  const { ctrl } = start();
  playSolution(ctrl);
  const arrows = (brush: string) => autoShapes(ctrl).filter(s => s.brush === brush).map(s => s.orig + s.dest);
  const done = ctrl.retro!.current()!;
  const others = deck.cards.filter(c => c.ply !== done.fault.node.ply);
  for (const other of others) {
    const best = ctrl.mainline.find(n => n.ply === other.ply)!.eval!.best!.slice(0, 4); // that card's answer
    ctrl.userJump(ctrl.mainlinePlyToPath(other.ply - 1)); // the position before the mistake
    expect(arrows('paleBlue')).toEqual([best]); // the best move from here
    ctrl.userJump(ctrl.mainlinePlyToPath(other.ply)); // after it
    expect(arrows('paleGreen')).toEqual([best]); // what should have been played instead
  }
  ctrl.userJump(done.prev.path); // and the card that's done, as before
  expect(arrows('paleBlue')).toEqual([done.solution.node.uci]);
});

test("a move is compared with our engine's eval of the position before, not Lichess's (not in lila)", async () => {
  const [card] = deck.cards; // Lichess's analysis: a forced mate before 20.Qh4??
  const before = mistakeOf(game, card).fen;
  engine.byFen[before] = [evaluation({ cp: 150 })]; // our engine sees much less in the position...
  engine.updates = [evaluation({ cp: 120 })]; // ...and the move keeps most of it
  const { ctrl, feedback } = startOn(card);
  ctrl.playUci(otherMove(card));
  await afterTheEngine();
  expect(feedback()).toBe('win'); // against Lichess's forced mate, it would be wrong
  expect(engine.asked).toEqual([before, ctrl.node.fen]); // the position before, then after the move
});

test("Training settings' Right answers: only the engine's best move, or also moves nearly as good", () => {
  const { history, deckCtrl } = start();
  const text = textOf(trainingSettingsView(trainingSettings(deckCtrl, history)));
  expect(text).toContain('only the engine’s best move');
  expect(text).toContain('On: only the engine’s best move counts as right. Off: moves nearly as good also count');
});

test("with 'only the engine's best move' on, any other move is wrong at once, without the engine", () => {
  const [card] = deck.cards;
  const deckCtrl = new DeckCtrl({ ...deck, cards: [card] }, { cards: {}, log: [] }, { ...defaultSettings, bestMoveOnly: true }, () => {});
  const ctrl = deckCtrl.analysis;
  ctrl.toggleRetro();
  ctrl.playUci(otherMove(card));
  expect(ctrl.retro!.feedback()).toBe('fail');
  expect(engine.asked).toEqual([]);
});

test("while solving, no clocks; once done, the game's clock times", () => {
  const { ctrl } = start();
  expect(renderClocks(ctrl, ctrl.path)).toBeUndefined();
  playSolution(ctrl);
  ctrl.userJump(ctrl.retro!.current()!.prev.path);
  expect(renderClocks(ctrl, ctrl.path)).toHaveLength(2);
});

test('"Show my move": the move you played as a red arrow, alone while solving, beside the others once done', () => {
  const [card] = deck.cards; // you played 20.Qh4 (h6h4)
  const { ctrl } = startOn(card);
  const arrows = () => autoShapes(ctrl).filter(s => s.dest).map(s => [s.brush, s.orig + s.dest]);
  expect(arrows()).toEqual([]); // off unless you ask
  ctrl.toggleBadMoveArrow();
  expect(arrows()).toEqual([['paleRed', 'h6h4']]);
  playSolution(ctrl);
  ctrl.userJump(ctrl.retro!.current()!.prev.path); // back at the position, now that it's solved
  expect(arrows()).toEqual([
    ['paleRed', 'h6h4'],
    ['paleGreen', 'd6f4'],
    ['paleBlue', 'h6g7'],
  ]);
  ctrl.toggleBadMoveArrow();
  expect(arrows()).not.toContainEqual(['paleRed', 'h6h4']);
});

test('the board marks, switched on: none while you solve a card; once done, on the pieces they describe', () => {
  vi.stubGlobal('localStorage', standIn({})); // where the browser keeps the analysis settings
  const [card] = deck.cards; // 20.Qh4?? when 20.Qxg7# was mate
  const { ctrl } = startOn(card);
  ctrl.settings.set('showMoveAnnotationsOnBoard', false); // so the marks are the only pictures
  for (const key of ['showUndefendedPieces', 'showPinnedPieces', 'showCheckableKing'] as const) ctrl.settings.set(key, true);
  const marks = () => autoShapes(ctrl).filter(s => s.customSvg).map(s => s.orig).sort();
  expect(marks()).toEqual([]); // while solving, they could give the answer away
  playSolution(ctrl);
  ctrl.userJump(ctrl.retro!.current()!.prev.path); // the position you faced
  const { board, epSquare, castlingRights } = parseFen(ctrl.node.fen).unwrap();
  const described = [
    ...detectPins(board).map(p => p.pinned),
    ...detectUndefended(board, epSquare).map(u => u.square),
    ...detectCheckable(board, epSquare, castlingRights).map(c => c.king),
  ]
    .map(makeSquare)
    .sort();
  expect(described.length).toBeGreaterThan(0);
  expect(marks()).toEqual(described);
});

test('variation arrows: once a card is done, an arrow for each move from its position, the selected one outlined', () => {
  vi.stubGlobal('localStorage', standIn({}));
  const [card] = deck.cards; // 20.Qh4?? (h6h4) when 20.Qxg7# (h6g7) was mate
  const { ctrl } = startOn(card);
  const arrows = () => autoShapes(ctrl).filter(s => s.dest).map(s => [s.brush, s.orig + s.dest, s.modifiers?.hilite]);
  expect(arrows()).toEqual([]); // while solving, none: the move list shows no moves from here
  playSolution(ctrl);
  ctrl.userJump(ctrl.retro!.current()!.prev.path);
  expect(arrows()).toEqual([
    ['paleGreen', 'd6f4', undefined],
    ['paleBlue', 'h6g7', undefined], // Lichess's move has an arrow already, outlined when it's selected
    ['variation', 'h6h4', '#3291ff'], // the game's move, selected: "next" follows it
  ]);
  ctrl.fork.select('next'); // what a tap of shift does, or the down key
  expect(arrows()).toEqual([
    ['paleGreen', 'd6f4', undefined],
    ['paleBlue', 'h6g7', 'white'],
    ['variation', 'h6h4', '#aaa'],
  ]);
  ctrl.settings.set('showVariationArrows', false); // the setting, or v
  expect(arrows().map(([brush]) => brush)).toEqual(['paleGreen', 'paleBlue']);
});

test('variation hiding: once the card is done, moves with variations get a fold button, which folds them away, for next time too', () => {
  vi.stubGlobal('localStorage', standIn({})); // where the browser keeps the folds
  const { ctrl } = start();
  const buttons = () => has(ctrl.treeView.render(), 'a.disclosure');
  expect(buttons()).toBe(false); // off by default, as in lila
  ctrl.settings.set('disclosureMode', true);
  expect(buttons()).toBe(false); // not while you solve: the list hides the lines and comments they'd fold
  playSolution(ctrl);
  expect(buttons()).toBe(true);
  const shows = (path: string): boolean => {
    const find = (v: VNode | string | undefined): boolean =>
      typeof v === 'object' && !!v && (v.data?.attrs?.p === path || (v.children ?? []).some(c => find(c as VNode)));
    return find(ctrl.treeView.render());
  };
  // Black's blunder at ply 62 has Lichess's line beside it: a variation of the move before.
  const parentPath = ctrl.mainlinePlyToPath(61);
  const linePath = parentPath + ctrl.tree.nodeAtPath(parentPath).children.find(c => c.comp)!.id;
  const folded = () => !!ctrl.tree.nodeAtPath(parentPath).collapsed;
  expect(shows(linePath)).toBe(true);
  ctrl.idbTree.setCollapsed(parentPath, true); // what its button does
  expect(shows(linePath)).toBe(false);
  ctrl.loadGame(game, 'white'); // the game again, for another of its cards, or after a reload
  expect(folded()).toBe(true); // as in lila, still folded
  ctrl.userJump(linePath); // going to a move in a folded line unfolds it...
  expect(folded()).toBe(false);
  ctrl.loadGame(game, 'white');
  expect(folded()).toBe(false); // ...for next time too
  ctrl.settings.set('disclosureMode', false);
});

// "Recent games": the deck's game, and a copy of it played 30 days before, with the same three cards.
const older: LichessGameJson = { ...game, id: 'older000', createdAt: game.createdAt! - 30 * 24 * 60 * 60_000 };
const twoGames: Deck = {
  ...deck,
  games: { [game.id]: game, [older.id]: older },
  cards: [...cardsOfGame(game, 'white'), ...cardsOfGame(older, 'white')],
  gameTimes: [game.createdAt!, older.createdAt!],
};
const lastGameOnly: Settings = { ...defaultSettings, recentGames: 1, gameRestDays: 0 };

test('with "Recent games" at 1, new cards only come from your last game, and the end of the session says so', () => {
  const deckCtrl = new DeckCtrl(twoGames, { cards: {}, log: [] }, lastGameOnly, () => {});
  const ctrl = deckCtrl.analysis;
  ctrl.toggleRetro();
  // The progress box counts the new cards from your last game, and says so when you point at them.
  const [, notStarted] = find(renderProgress(deckCtrl), 'div.mt-progress__counts')!.children as VNode[];
  expect(textOf(notStarted)).toBe('3 not started');
  expect(notStarted.data!.attrs!.title).toBe('New cards from your last game');
  const dealt: string[] = [];
  for (let i = 0; i < 3; i++) {
    dealt.push(ctrl.game.id);
    ctrl.retro!.skip(); // records it, and deals the next card, if there is one
  }
  expect(dealt).toEqual([game.id, game.id, game.id]);
  expect(ctrl.retro!.current()).toBeNull(); // nothing more
  expect(ctrl.retro!.card!.summary()).toContain(
    "You've started all the cards from your last game. For more, raise that number in Training settings (Recent games).",
  );
  // Raised to 2 in Training settings: the older game's cards come up.
  deckCtrl.useSettings({ ...lastGameOnly, recentGames: 2 });
  ctrl.retro!.card!.restart();
  expect(ctrl.game.id).toBe(older.id);
  expect(deckCtrl.progress().notStarted).toBe(3); // the one on screen too, until you answer it
});

test('a card you started from an older game keeps coming back, whatever "Recent games" says', () => {
  const olderCard = `${older.id}/${cardsOfGame(older, 'white')[0].ply}`;
  const history: ReviewHistory = {
    cards: { [olderCard]: { ...createEmptyCard(new Date(0)), state: State.Review, due: new Date(Date.now() - 60_000) } },
    log: [],
  };
  const deckCtrl = new DeckCtrl(twoGames, history, lastGameOnly, () => {});
  deckCtrl.analysis.toggleRetro();
  expect(`${deckCtrl.analysis.game.id}/${deckCtrl.analysis.retro!.card!.ply}`).toBe(olderCard); // due, so first
  expect(deckCtrl.progress()).toMatchObject({ started: 1, notStarted: 3 });
});

test('Training settings: "Recent games" says what it takes in, as you type', () => {
  const history: ReviewHistory = { cards: {}, log: [] };
  const page = (recentGames: number | null) =>
    new SettingsPageCtrl(twoGames, history, { ...defaultSettings, recentGames }, () => {}, () => {}, notLoaded(), noUpdate());
  const counts = (recentGames: number | null) => textOf(find(trainingSettingsView(page(recentGames)), 'form.mt-settings'));
  const day = new Date(game.createdAt!).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  expect(counts(1)).toContain(`Your last game, on ${day}, has 3 cards, 3 of them not started.`);
  expect(counts(5)).toContain('That’s all your 2 games.');
  expect(counts(null)).not.toContain('Your last');
  // The input with the id recentGames: empty, for all your games.
  const byId = (v: VNode | string | undefined, id: string): VNode | undefined =>
    typeof v !== 'object' || !v ? undefined : v.data?.attrs?.id === id ? v : (v.children ?? []).map(c => byId(c as VNode, id)).find(Boolean);
  expect(byId(trainingSettingsView(page(null)), 'recentGames')?.data?.attrs).toMatchObject({ type: 'number', value: '' });
});

test('"Your stats", from the progress box: how often you found the move; the last 30 days too, once some reviews are older', () => {
  const DAY = 24 * 60 * 60_000;
  const review = (cardId: string, result: 'win' | 'fail', daysAgo: number) =>
    ({ cardId, result, log: { review: new Date(Date.now() - daysAgo * DAY).toISOString() } }) as unknown as ReviewHistory['log'][number];
  // The dialog's table, row by row, after clicking "Your stats".
  const stats = (log: ReviewHistory['log']) => {
    const deckCtrl = new DeckCtrl(deck, { cards: {}, log }, defaultSettings, () => {});
    deckCtrl.analysis.toggleRetro();
    expect(deckCtrl.statsOpen).toBe(false);
    click(find(renderProgress(deckCtrl), 'a.mt-progress__stats'));
    expect(deckCtrl.statsOpen).toBe(true);
    const dialog = renderStats(deckCtrl);
    const table = find(dialog, 'table');
    deckCtrl.closeStats();
    expect(deckCtrl.statsOpen).toBe(false);
    return table
      ? (table.children as VNode[]).slice(1).map(part => (part.children as VNode[]).map(row => textOf(row).trim().replace(/\s+/g, ' ')))
      : textOf(dialog).trim();
  };
  expect(stats([])).toBe('Your stats No reviews yet.');
  // All in the last 30 days: one column.
  expect(stats([review('a/1', 'fail', 9), review('b/1', 'win', 8), review('a/1', 'win', 1)])).toEqual([
    ['All your reviews'],
    [
      'The first time 50% (1 of 2)',
      'When a card came back 100% (1 of 1)',
      '… after getting it wrong 100% (1 of 1)',
      '… after getting it right –',
    ],
  ]);
  // One older than that: the last 30 days get a column of their own.
  expect(stats([review('a/1', 'fail', 40), review('b/1', 'win', 8), review('a/1', 'win', 1)])).toEqual([
    ['All your reviews Last 30 days'],
    [
      'The first time 50% (1 of 2) 100% (1 of 1)',
      'When a card came back 100% (1 of 1) 100% (1 of 1)',
      '… after getting it wrong 100% (1 of 1) 100% (1 of 1)',
      '… after getting it right – –',
    ],
  ]);
  // Not in Training settings any more.
  const page = new SettingsPageCtrl(deck, { cards: {}, log: [review('a/1', 'win', 1)] }, defaultSettings, () => {}, () => {}, notLoaded(), noUpdate());
  expect(textOf(trainingSettingsView(page))).not.toContain('How often you found the move');
});

// The masters database when an opening card comes up (retroCtrl's jumpToNext, as lila's). Here
// ply 39 is an opening mistake (the middlegame starts at 40), and comes first ("Openings first",
// up to move 20); then ply 41.
const opening: LichessGameJson = { ...game, division: { middle: 40, end: 80 } };
const [card39, card41] = cardsOfGame(opening, 'white');
const openingFirst: Settings = { ...defaultSettings, newCardOrder: 'openings', openingMoves: 20, gameRestDays: 0 };
function withMasters(answer: () => Promise<MasterMove[]>) {
  const moves = vi.fn(async (_fen: string) => answer());
  const twoCards: Deck = { ...deck, games: { [opening.id]: opening }, cards: [card39, card41] };
  const deckCtrl = new DeckCtrl(twoCards, { cards: {}, log: [] }, openingFirst, () => {}, { moves });
  deckCtrl.analysis.toggleRetro();
  return { deckCtrl, ctrl: deckCtrl.analysis, moves };
}
const ply = (ctrl: AnalysisCtrl) => ctrl.retro!.card!.ply;

test("an opening card whose mistake masters played is a book move: it goes, as on Lichess, and the next comes", async () => {
  const { uci, fen } = mistakeOf(opening, card39);
  const { deckCtrl, ctrl, moves } = withMasters(async () => [{ uci, white: 2, draws: 0, black: 0 }]);
  expect(ply(ctrl)).toBe(39);
  expect(moves.mock.calls.map(([f]) => f)).toEqual([fen]); // asked about the card's position
  await new Promise(resolve => setTimeout(resolve, 200)); // lila moves on after 100 ms
  expect(ply(ctrl)).toBe(41);
  expect(deckCtrl.progress().notStarted).toBe(1); // gone for the session
});

test("otherwise, the moves masters played count as right answers, with no engine needed", async () => {
  const masterMove = otherMove(card39);
  const { ctrl } = withMasters(async () => [{ uci: masterMove, white: 3, draws: 1, black: 0 }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  ctrl.playUci(masterMove);
  expect(ctrl.retro!.feedback()).toBe('win');
  expect(engine.asked).toEqual([]);
});

test("if you've answered before the masters database does, the card stays, even for a book move", async () => {
  const { uci } = mistakeOf(opening, card39);
  let answer!: (moves: MasterMove[]) => void;
  const { ctrl } = withMasters(() => new Promise(resolve => (answer = resolve)));
  playGameMove(ctrl); // wrong, and quick
  answer([{ uci, white: 2, draws: 0, black: 0 }]);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect([ply(ctrl), ctrl.retro!.feedback()]).toEqual([39, 'fail']);
});
