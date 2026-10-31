// motif.test.ts: checks the board marks' detection (motif.ts, which is lila's) on small positions.
import { INITIAL_FEN, parseFen } from 'chessops/fen';
import { parseSquare } from 'chessops/util';
import { expect, test } from 'vitest';

import { detectCheckable, detectPins, detectUndefended } from './motif';

const setup = (fen: string) => parseFen(fen).unwrap();
const sq = (name: string) => parseSquare(name)!;

test('the starting position: nothing pinned, nothing to win, and no check in one move', () => {
  const { board, epSquare, castlingRights } = setup(INITIAL_FEN);
  expect(detectPins(board)).toEqual([]);
  expect(detectUndefended(board, epSquare)).toEqual([]);
  expect(detectCheckable(board, epSquare, castlingRights)).toEqual([]);
});

test('a pinned piece: the bishop in front of its king, with a rook behind it', () => {
  const { board } = setup('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
  expect(detectPins(board)).toEqual([{ pinned: sq('e2'), pinner: sq('e7'), target: sq('e1') }]);
});

test('an undefended piece: a knight the rook takes for nothing; defended by a pawn, it is not', () => {
  const { board } = setup('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1');
  expect(detectUndefended(board)).toEqual([{ square: sq('d5'), materialLoss: 3, principalAttacker: sq('d1') }]);
  // The pawn on e6 would take back: the rook (5) for the knight (3).
  expect(detectUndefended(setup('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1').board)).toEqual([]);
});

test('a king that can be checked: the rook can check it along the back rank', () => {
  const { board, epSquare, castlingRights } = setup('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  expect(detectCheckable(board, epSquare, castlingRights).map(c => c.king)).toEqual([sq('e8')]);
});
