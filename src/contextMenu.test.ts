// contextMenu.test.ts: checks the move list's right-click menu (contextMenu.ts): the items it
// offers on each move, what "Copy main line PGN" and "Copy variation PGN" copy, the moves the list
// highlights while the pointer is over one, "Collapse all" / "Expand all", and the items that change
// the moves: "Promote variation", "Make main line", "Convert to variation", and "Delete from here",
// including on a card's game once the card is done. The menu is built here as the page builds it;
// opening it with a right-click (treeView.ts), and that it doesn't open while you solve a card, are
// checked in the browser.
import type { VNode } from 'snabbdom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import { AnalysisCtrl } from './analysisCtrl';
import { compute as autoShapes } from './autoShape';
import { renderResult } from './components';
import { view } from './contextMenu';
import { cardsOfGame, type Deck } from './deck';
import { DeckCtrl } from './deckCtrl';
import retroView from './retroView';
import type { ReviewHistory } from './reviews';
import { defaultSettings } from './settings';
import { renderSide } from './side';
import type { LichessGameJson } from './tree';

const game = real1 as unknown as LichessGameJson;
const sans = game.moves.split(' '); // 1. d4 d5 2. c4 e6 ...

// Stand-ins for the browser: a mouse rather than a touch screen, the clipboard, and localStorage,
// where the board's settings and the folds are kept. Copied from a line's last move, lila's text
// ends with a space, which the tests leave out.
let copied: string[];
beforeEach(() => {
  copied = [];
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('navigator', { clipboard: { writeText: async (text: string) => copied.push(text.trimEnd()) } });
  const stored: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => (stored[key] = value),
    removeItem: (key: string) => delete stored[key],
  });
});
afterEach(() => vi.unstubAllGlobals());

// Moves written as PGN, numbered from `ply`, that of the first: "20. Qxg7+ Kxg7 21. Nf5+".
const numbered = (moves: string[], ply = 1): string =>
  moves
    .map((san, i) => ((ply + i) % 2 === 1 ? `${(ply + i + 1) / 2}. ` : i === 0 ? `${(ply + i) / 2}... ` : '') + san)
    .join(' ');

const textOf = (v: VNode | string | undefined): string =>
  typeof v === 'string' ? v : !v ? '' : (v.text ?? '') + (v.children ?? []).map(c => textOf(c as VNode)).join(' ');
// The menu for the move at `path`, as it opens at the top left of the page; its title, then the
// text of each item (lila's menu leaves an empty text where an item isn't offered on the root); and
// one of the items.
const menuAt = (ctrl: AnalysisCtrl, path: string): VNode => view(ctrl, path, { x: 0, y: 0 });
const items = (menu: VNode): string[] => (menu.children as VNode[]).map(textOf).filter(Boolean);
const item = (menu: VNode, text: string): VNode => (menu.children as VNode[]).find(c => textOf(c) === text)!;
// An item's event listeners, which it adds once it's on the page.
function listeners(item: VNode): Record<string, () => void> {
  const added: Record<string, () => void> = {};
  const elm = { addEventListener: (type: string, f: () => void) => (added[type] = f) };
  item.data!.hook!.insert!({ ...item, elm } as unknown as VNode);
  return added;
}
const choose = (ctrl: AnalysisCtrl, path: string, text: string) => listeners(item(menuAt(ctrl, path), text)).click();

// The paths of the moves in the move list, or of the ones it shows with the class `cls`.
function moves(ctrl: AnalysisCtrl, cls?: string): string[] {
  const paths: string[] = [];
  const walk = (v: VNode | string | undefined) => {
    if (typeof v !== 'object' || !v) return;
    if (v.sel === 'move' && (!cls || v.data?.class?.[cls])) paths.push(v.data!.attrs!.p as string);
    (v.children ?? []).forEach(c => walk(c as VNode));
  };
  walk(ctrl.treeView.render());
  return paths;
}
// Whether the move list shows the move at `path` in a variation (a <line>).
function inVariation(ctrl: AnalysisCtrl, path: string): boolean | undefined {
  let found: boolean | undefined;
  const walk = (v: VNode | string | undefined, inLine: boolean) => {
    if (typeof v !== 'object' || !v) return;
    if (v.sel === 'move' && v.data?.attrs?.p === path) found = inLine;
    (v.children ?? []).forEach(c => walk(c as VNode, inLine || v.sel === 'line'));
  };
  walk(ctrl.treeView.render(), false);
  return found;
}

// The paths of a line's moves, from its first one.
function linePaths(ctrl: AnalysisCtrl, path: string): string[] {
  const paths = [path];
  for (let node = ctrl.tree.nodeAtPath(path); node.children[0]; node = node.children[0])
    paths.push(paths.at(-1)! + node.children[0].id);
  return paths;
}
// The path of the first move of Lichess's line beside the game's move at `ply`.
const lichessLine = (ctrl: AnalysisCtrl, ply: number): string => {
  const parentPath = ctrl.mainlinePlyToPath(ply - 1);
  return parentPath + ctrl.tree.nodeAtPath(parentPath).children.find(c => c.comp)!.id;
};
const line39 = ['Qxg7+', 'Kxg7', 'Nf5+', 'Kg8', 'Nh6#']; // Lichess's line instead of the game's 20. Qh4

test('on a move of the game, the menu has its name and "Copy main line PGN", which copies the game\'s moves, without the lines beside them', () => {
  const ctrl = new AnalysisCtrl(game);
  const titles: Record<string, string> = {
    [ctrl.mainlinePlyToPath(39)]: '20. Qh4',
    [ctrl.mainlinePlyToPath(40)]: `20... ${sans[39]}`,
    [ctrl.gamePath]: `38... ${sans[75]}`, // the game's last move
  };
  for (const [path, title] of Object.entries(titles)) {
    const menu = menuAt(ctrl, path);
    expect(items(menu)).toEqual([title, 'Convert to variation', 'Copy main line PGN', 'Delete from here']);
    listeners(item(menu, 'Copy main line PGN')).click();
    expect(copied.pop()).toBe(numbered(sans));
  }
  // A right-click beside the moves: the starting position, which can't be converted or deleted.
  expect(items(menuAt(ctrl, ''))).toEqual(['Initial position', 'Copy main line PGN']);
  choose(ctrl, '', 'Copy main line PGN');
  expect(copied.pop()).toBe(numbered(sans));
});

test('in a variation, "Copy variation PGN" copies the moves that lead to it and the ones after it', () => {
  const ctrl = new AnalysisCtrl(game);
  const line = linePaths(ctrl, lichessLine(ctrl, 39));
  const expected = numbered([...sans.slice(0, 38), ...line39]);
  for (const path of line) {
    const menu = menuAt(ctrl, path);
    // Not "Promote variation" here: that would make it the main line too.
    expect(items(menu).slice(1)).toEqual(['Make main line', 'Copy variation PGN', 'Delete from here']);
    listeners(item(menu, 'Copy variation PGN')).click();
    expect(copied.pop()).toBe(expected);
  }
  expect(items(menuAt(ctrl, line[2]))[0]).toBe('21. Nf5+');
});

test('a variation within the variation is copied too, in brackets', () => {
  const ctrl = new AnalysisCtrl(game);
  const path = lichessLine(ctrl, 21); // Lichess's 11. Re1, instead of 11. a3
  ctrl.userJump(path);
  ctrl.playSan('h6'); // a move of your own, instead of the line's 11... Bd7
  choose(ctrl, path, 'Copy variation PGN');
  expect(copied.pop()).toBe(
    numbered(sans.slice(0, 20)) + ' 11. Re1 Bd7 (11... h6) 12. a3 Be7 13. Nc4 O-O 14. Bb1 b5 15. Ncd2 Qc7 16. Nb3 Rfc8',
  );
  // The main line is still the game's moves only.
  choose(ctrl, '', 'Copy main line PGN');
  expect(copied.pop()).toBe(numbered(sans));
});

test('while the pointer is over "Copy ... PGN" or "Delete from here", the move list highlights those moves, and the menu turns see-through', () => {
  const menuClasses = new Set<string>();
  const menuElement = { classList: { add: (c: string) => menuClasses.add(c), remove: (c: string) => menuClasses.delete(c) } };
  vi.stubGlobal('document', { getElementById: () => menuElement });
  const ctrl = new AnalysisCtrl(game);
  const gameMoves = ctrl.mainline.slice(1).map(n => ctrl.mainlinePlyToPath(n.ply));

  const mainPath = ctrl.mainlinePlyToPath(39);
  ctrl.contextMenuPath = mainPath; // as when the menu opens on it
  expect(moves(ctrl, 'context-menu')).toEqual([mainPath]);
  const copyMain = listeners(item(menuAt(ctrl, mainPath), 'Copy main line PGN'));
  copyMain.mouseover();
  expect(moves(ctrl, 'pending-copy').sort()).toEqual([...gameMoves].sort());
  expect(moves(ctrl).length).toBeGreaterThan(gameMoves.length); // the lines beside the game aren't highlighted
  expect(menuClasses.has('transparent')).toBe(true);
  copyMain.mouseout();
  expect(moves(ctrl, 'pending-copy')).toEqual([]);
  expect(menuClasses.has('transparent')).toBe(false);

  const line = linePaths(ctrl, lichessLine(ctrl, 39));
  const copyLine = listeners(item(menuAt(ctrl, line[2]), 'Copy variation PGN'));
  copyLine.mouseover();
  expect(moves(ctrl, 'pending-copy').sort()).toEqual([...gameMoves.slice(0, 38), ...line].sort());
  copyLine.mouseout();
  expect(moves(ctrl, 'pending-copy')).toEqual([]);

  const deleteMain = listeners(item(menuAt(ctrl, mainPath), 'Delete from here'));
  deleteMain.mouseover();
  const after = moves(ctrl).filter(p => p.startsWith(mainPath)); // 20. Qh4 and all that comes after it
  expect(after.length).toBeGreaterThan(gameMoves.length - 38);
  expect(moves(ctrl, 'pending-deletion')).toEqual(after);
  expect(menuClasses.has('transparent')).toBe(true);
  deleteMain.mouseout();
  expect(moves(ctrl, 'pending-deletion')).toEqual([]);
});

test('with variation hiding on, "Collapse all" folds every variation away, and "Expand all" brings them back', () => {
  const ctrl = new AnalysisCtrl(game);
  const path = ctrl.mainlinePlyToPath(39);
  const others = ['Convert to variation', 'Copy main line PGN', 'Delete from here'];
  expect(items(menuAt(ctrl, path))).toEqual(['20. Qh4', ...others]); // variation hiding is off at first, as in lila
  ctrl.settings.set('disclosureMode', true);
  expect(items(menuAt(ctrl, path))).toEqual(['20. Qh4', 'Collapse all', ...others]);

  const variationMoves = () => moves(ctrl).filter(p => !ctrl.tree.pathIsMainline(p)).length;
  const before = variationMoves();
  expect(before).toBeGreaterThan(0);
  choose(ctrl, path, 'Collapse all');
  expect(variationMoves()).toBe(0);
  expect(items(menuAt(ctrl, path))).toEqual(['20. Qh4', 'Expand all', ...others]);
  choose(ctrl, path, 'Expand all');
  expect(variationMoves()).toBe(before);
  expect(items(menuAt(ctrl, path))).toEqual(['20. Qh4', 'Collapse all', ...others]);
});

test('"Make main line" makes a variation the main line, and the game\'s moves a variation; the board goes to it', () => {
  const ctrl = new AnalysisCtrl(game);
  const qh4 = ctrl.mainlinePlyToPath(39); // the game's 20. Qh4
  const line = linePaths(ctrl, lichessLine(ctrl, 39));
  choose(ctrl, line[2], 'Make main line');
  expect(ctrl.path).toBe(line[2]);
  expect(ctrl.mainline.slice(1).map(n => n.san)).toEqual([...sans.slice(0, 38), ...line39]);
  expect(inVariation(ctrl, line[2])).toBe(false);
  expect(inVariation(ctrl, qh4)).toBe(true);
  expect(items(menuAt(ctrl, qh4)).slice(1)).toEqual(['Make main line', 'Copy variation PGN', 'Delete from here']);
  ctrl.navigate.last(); // the End key: to the end of the main line, which is the line's now
  expect(ctrl.path).toBe(line[4]);
  choose(ctrl, '', 'Copy main line PGN');
  expect(copied.pop()).toBe(numbered([...sans.slice(0, 38), ...line39]));
  choose(ctrl, qh4, 'Make main line'); // and back
  expect(ctrl.mainline.slice(1).map(n => n.san)).toEqual(sans);
});

test('"Promote variation" moves a variation up one level, in place of the line it branches from', () => {
  const ctrl = new AnalysisCtrl(game);
  const re1 = lichessLine(ctrl, 21); // Lichess's 11. Re1, instead of the game's 11. a3
  ctrl.userJump(re1);
  ctrl.playSan('h6'); // your own 11... h6, instead of the line's 11... Bd7
  const h6 = ctrl.path;
  expect(items(menuAt(ctrl, h6))).toEqual(['11... h6', 'Promote variation', 'Make main line', 'Copy variation PGN', 'Delete from here']);
  choose(ctrl, h6, 'Promote variation');
  expect(ctrl.tree.nodeAtPath(re1).children.map(n => n.san)).toEqual(['h6', 'Bd7']); // the line goes on with it now
  expect(ctrl.tree.pathIsMainline(re1)).toBe(false); // still beside the game's 11. a3
  // Promoting it again would make it the main line, which "Make main line" already offers.
  expect(items(menuAt(ctrl, h6)).slice(1)).toEqual(['Make main line', 'Copy variation PGN', 'Delete from here']);
});

test('"Convert to variation" shows the main line from a move on as a variation; "Make main line" undoes it', () => {
  const ctrl = new AnalysisCtrl(game);
  const e5 = ctrl.mainlinePlyToPath(70); // 35... e5
  expect(inVariation(ctrl, e5)).toBe(false);
  choose(ctrl, e5, 'Convert to variation');
  expect(ctrl.path).toBe(e5);
  expect(inVariation(ctrl, e5)).toBe(true);
  expect(inVariation(ctrl, ctrl.gamePath)).toBe(true); // and the moves after it
  expect(items(menuAt(ctrl, e5)).slice(1)).toEqual(['Promote variation', 'Make main line', 'Copy variation PGN', 'Delete from here']);
  choose(ctrl, '', 'Copy main line PGN');
  expect(copied.pop()).toBe(numbered(sans.slice(0, 69))); // the main line stops before it

  choose(ctrl, ctrl.mainlinePlyToPath(60), 'Convert to variation'); // only one move at a time is converted
  expect(inVariation(ctrl, ctrl.mainlinePlyToPath(60))).toBe(true);
  expect(ctrl.tree.nodeAtPath(e5).forceVariation).toBe(false);

  choose(ctrl, ctrl.mainlinePlyToPath(65), 'Make main line');
  expect(inVariation(ctrl, ctrl.mainlinePlyToPath(60))).toBe(false);
  choose(ctrl, '', 'Copy main line PGN');
  expect(copied.pop()).toBe(numbered(sans));
});

test('"Delete from here" deletes a move and all that comes after it, asking first if that\'s a lot; the board goes back if it was there', () => {
  const asked: string[] = [];
  let answer = false;
  vi.stubGlobal('confirm', (question: string) => (asked.push(question), answer));
  const ctrl = new AnalysisCtrl(game);

  const line = linePaths(ctrl, lichessLine(ctrl, 39));
  ctrl.userJump(line[3]); // the board on 21... Kg8
  choose(ctrl, line[1], 'Delete from here'); // from 20... Kxg7: 4 moves, no comments, so it doesn't ask
  expect(asked).toEqual([]);
  expect(ctrl.tree.nodeAtPath(line[0]).children).toEqual([]); // only 20. Qxg7+ is left of the line
  expect(ctrl.path).toBe(line[0]);

  // From the game's 30. f4: its last 18 moves, Lichess's lines beside 5 of them, and the comments on those.
  const f4 = ctrl.mainlinePlyToPath(59);
  choose(ctrl, f4, 'Delete from here');
  expect(asked).toEqual(['Delete 58 moves and 5 comments?']);
  expect(ctrl.mainline).toHaveLength(77); // you said no: all still there
  answer = true;
  choose(ctrl, f4, 'Delete from here');
  expect(ctrl.mainline.slice(1).map(n => n.san)).toEqual(sans.slice(0, 58));
  expect(ctrl.path).toBe(line[0]); // the board wasn't on those moves, so it stays
});

test('how the game ended stays as it was, whatever you delete', () => {
  vi.stubGlobal('confirm', () => true);
  // As if the game had been lost on time: who ran out of time depends on whose turn it was at the end.
  const ctrl = new AnalysisCtrl({ ...game, status: 'outoftime', winner: 'black' });
  const ended = 'White ran out of time • Black is victorious';
  expect(textOf(renderSide(ctrl))).toContain(ended);
  choose(ctrl, ctrl.gamePath, 'Delete from here'); // the game's last move, Black's
  expect(textOf(renderSide(ctrl))).toContain(ended);
  expect(renderResult(ctrl).map(textOf).join(' ')).toContain(ended);
});

test("once a card is done, editing its game doesn't upset the card: its panel, rating it, and the next card's game, whole again", () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 })); // saving the review
  vi.stubGlobal('confirm', () => true);
  const deck: Deck = { username: 'mugglesman1982', builtAt: '', games: { [game.id]: game }, cards: cardsOfGame(game, 'white'), gameTimes: [game.createdAt!] };
  const history: ReviewHistory = { cards: {}, log: [] };
  // The game's other cards can come next at once, so the next card is from the same game.
  const deckCtrl = new DeckCtrl(deck, history, { ...defaultSettings, gameRestDays: 0 }, () => {});
  const ctrl = deckCtrl.analysis;
  ctrl.toggleRetro();
  const retro = () => ctrl.retro!;
  const card = retro().current()!;
  ctrl.playUci(card.solution.node.uci!); // the right move: the card is done
  expect(ctrl.hidingHints()).toBe(false);

  // Lichess's line becomes the main line, then the game goes from move 10 on, the card's position with it.
  choose(ctrl, card.solution.path, 'Make main line');
  choose(ctrl, ctrl.mainlinePlyToPath(19), 'Delete from here');
  expect(ctrl.mainline).toHaveLength(19);
  expect(ctrl.path).toBe(ctrl.mainlinePlyToPath(18));

  expect(textOf(retroView(ctrl))).toContain('Good move'); // the panel, as it was
  ctrl.toggleBadMoveArrow(); // "Show my move"
  expect(() => autoShapes(ctrl)).not.toThrow();
  ctrl.navigate.last();
  ctrl.navigate.first();
  retro().card!.ratingChoices()![1].rate();
  expect(history.log.map(e => [e.cardId, e.result])).toEqual([[`${game.id}/${card.fault.node.ply}`, 'win']]);

  retro().jumpToNext(); // "Next"
  expect(retro().current()!.fault.node.ply).not.toBe(card.fault.node.ply);
  expect(ctrl.mainline.slice(1).map(n => n.san)).toEqual(sans);
  expect(ctrl.hidingHints()).toBe(true);
});
