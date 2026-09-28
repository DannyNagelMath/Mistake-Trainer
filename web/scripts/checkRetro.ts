// checkRetro.ts: runs "Learn from your mistakes" on one game with no board, playing moves the
// way the board will, and checks retroCtrl's state after each one.
// Usage: npx tsx scripts/checkRetro.ts [path/to/game.json]   (default: fixtures/game1.json)

import { readFileSync } from 'node:fs';
import { makeUci, type Color } from 'chessops';
import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { scalachessCharPair } from 'chessops/compat';

import { AnalysisCtrl } from '../src/analysisCtrl';
import type { TreeNode } from '../src/tree';

const file = process.argv[2] ?? 'fixtures/game1.json';
const ctrl = new AnalysisCtrl(JSON.parse(readFileSync(file, 'utf8')));
const retro = () => ctrl.retro!; // the ! tells TypeScript it is defined, which it is while the panel is open

const failures: string[] = [];
function expect(where: string, what: string, actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  failures.push(`${where}: ${what} is ${String(actual)}, expected ${String(expected)}`);
  return false;
}

// Paths are unreadable strings of 2-character ids, so failures describe the node instead.
function expectBoardAt(where: string, what: string, expectedPath: string): void {
  if (ctrl.path === expectedPath) return;
  failures.push(`${where}: ${what} is ${describePath(ctrl.path)}, expected ${describePath(expectedPath)}`);
}
function describePath(path: string): string {
  try {
    const node = ctrl.tree.nodeAtPath(path);
    return `ply ${node.ply} ${node.san ?? '(start)'}${ctrl.tree.pathIsMainline(path) ? '' : ' (off the game line)'}`;
  } catch {
    return 'a position no longer in the tree';
  }
}

// Works through every mistake for one color: the game move, then some other move, then the
// engine's move. This is what happens when you use the panel without ever asking for help.
function reviewColor(color: Color): void {
  expect(color, 'retro color', retro().color, color);
  const total = retro().completion()[1];
  const mistakes: string[] = [];

  for (let cur = retro().current(); cur; cur = retro().current()) {
    const where = `${color}, ply ${cur.fault.node.ply} ${cur.fault.node.san}`;
    mistakes.push(`ply ${cur.fault.node.ply} ${cur.fault.node.san}`);
    expect(where, 'feedback', retro().feedback(), 'find');
    expectBoardAt(where, 'board position', cur.prev.path);
    if (mistakes.length === 1) checkNavigation(where, cur.prev.path, cur.fault.node);

    // The game move and the engine's move are already in the tree, so playing them must reuse
    // those nodes, and any other move must be deleted after it fails. Either way, the number of
    // moves from this position should never change.
    const moveCount = ctrl.node.children.length;

    ctrl.playUci(boardUci(cur.fault.node));
    expect(where, 'feedback after the game move', retro().feedback(), 'fail');
    expectBoardAt(where, 'board position after the game move', cur.prev.path);
    expect(where, 'moves from this position after the game move', ctrl.node.children.length, moveCount);

    const other = anotherMove(ctrl.node);
    if (other) {
      ctrl.playUci(other);
      expect(where, `feedback after another move (${other})`, retro().feedback(), 'fail');
      expectBoardAt(where, 'board position after another move', cur.prev.path);
      expect(where, 'moves from this position after another move', ctrl.node.children.length, moveCount);
    }

    ctrl.playUci(boardUci(cur.solution.node));
    const won = expect(where, 'feedback after the engine move', retro().feedback(), 'win');
    expectBoardAt(where, 'board position after the engine move', cur.solution.path);
    if (!won) return; // otherwise jumpToNext would return this same mistake forever
    retro().jumpToNext();
  }
  expect(color, 'progress at the end', retro().completion().join('/'), `${total}/${total}`);
  console.log(`${color}: ${total} to learn from${mistakes.length ? ': ' + mistakes.join(', ') : ''}`);
}

// Behavior at the start of the first mistake: the forward arrow is blocked, the move you played
// is the one shown as an arrow, and stepping away and back switches feedback to offTrack and back.
function checkNavigation(where: string, prevPath: string, fault: TreeNode): void {
  expect(where, 'forward arrow blocked', retro().preventGoingToNextMove(), true);
  expect(where, 'move shown as the bad move', retro().showBadNode()?.san, fault.san);
  if (prevPath === '') return; // can't step back from the starting position
  ctrl.userJump(prevPath.slice(0, -2));
  expect(where, 'feedback after stepping back', retro().feedback(), 'offTrack');
  ctrl.userJump(prevPath);
  expect(where, 'feedback after returning', retro().feedback(), 'find');
}

// "Do it again" (reset) goes back to the first mistake; then "View the solution".
function checkViewSolution(color: Color): void {
  retro().reset();
  const cur = retro().current();
  if (!cur) return;
  retro().viewSolution();
  expect(color, 'feedback after viewing the solution', retro().feedback(), 'view');
  expectBoardAt(color, 'board position after viewing the solution', cur.solution.path);
}

// The tree stores castling as king-takes-rook (e1h1), but the board reports the king's
// two-square move (e1g1). Sending the board's form checks that the adapter normalizes it.
function boardUci(node: TreeNode): string {
  const kingDestination: Record<string, string> = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };
  return node.san?.startsWith('O-O') ? (kingDestination[node.uci!] ?? node.uci!) : node.uci!;
}

// A legal move that isn't already in the tree (so neither the game move nor the engine's move)
// and doesn't give checkmate, since retroCtrl counts any checkmate as a correct answer.
function anotherMove(node: TreeNode): string | undefined {
  const pos = Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
  const inTree = new Set(node.children.map(c => c.id));
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const move = normalizeMove(pos, { from, to });
      if (!pos.isLegal(move) || inTree.has(scalachessCharPair(move))) continue;
      const after = pos.clone();
      after.play(move);
      if (!after.isCheckmate()) return makeUci(move);
    }
  }
  return undefined;
}

ctrl.toggleRetro(); // opens for the color at the bottom: White
reviewColor('white');
checkViewSolution('white');

ctrl.flip(); // what the panel's "Review Black's mistakes" button does
reviewColor('black');
checkViewSolution('black');

ctrl.toggleRetro();
expect('closing', 'retro', ctrl.retro, undefined);

if (failures.length) {
  console.log(`${failures.length} FAILED:`);
  failures.forEach(f => console.log(`  ${f}`));
  process.exitCode = 1;
} else console.log('All checks passed.');