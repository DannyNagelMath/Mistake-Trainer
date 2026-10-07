// deckCtrl.test.ts: checks how DeckCtrl grades a card. A wrong first move, "View the solution",
// or "Skip" is Again at once; the right first move waits for you to choose Hard, Good, or Easy.
// Moves are played through the controller, the way the board plays them. Saving is stubbed out,
// so nothing is written anywhere.
import { Rating } from 'ts-fsrs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import type { AnalysisCtrl } from './analysisCtrl';
import { cardsOfGame, type Deck } from './deck';
import { DeckCtrl } from './deckCtrl';
import type { ReviewHistory } from './reviews';
import type { LichessGameJson } from './tree';

const game = real1 as unknown as LichessGameJson;
const deck: Deck = { username: 'mugglesman1982', builtAt: '', games: { [game.id]: game }, cards: cardsOfGame(game, 'white') };

let saved: unknown[]; // what the page sent to save
beforeEach(() => {
  saved = [];
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
function start() {
  const history: ReviewHistory = { cards: {}, log: [] };
  const deckCtrl = new DeckCtrl(deck, history, () => {});
  const ctrl = deckCtrl.analysis;
  ctrl.toggleRetro();
  return { history, ctrl, retro: () => ctrl.retro! };
}
const playSolution = (ctrl: AnalysisCtrl) => ctrl.playUci(ctrl.retro!.current()!.solution.node.uci!);
const playGameMove = (ctrl: AnalysisCtrl) => ctrl.playUci(ctrl.retro!.current()!.fault.node.uci!);

test('the right first move records nothing until you choose how it went', () => {
  const { history, ctrl, retro } = start();
  playSolution(ctrl);
  expect(retro().feedback()).toBe('win');
  expect(history.log).toHaveLength(0);
  const choices = retro().card!.ratingChoices();
  expect(choices?.map(c => c.label)).toEqual(['Worked it out', 'Found it quickly', 'Obvious']);
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
