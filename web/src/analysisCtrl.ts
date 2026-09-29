// analysisCtrl.ts: the object retroCtrl calls `root`. It holds the tree and the position the
// board shows, and implements RetroRoot. It plays the role of lila's AnalyseCtrl
// (ui/analyse/src/ctrl.ts); steps 3-4 will add board input and page rendering to it.

import { opposite, parseUci, makeUci, type Color, type Move } from 'chessops';
import { Chess, normalizeMove } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { scalachessCharPair, chessgroundDests } from 'chessops/compat';
import type { Api as CgApi } from '@lichess-org/chessground/api'; // Step 3a
import type { Config as CgConfig } from '@lichess-org/chessground/config'; // Step 3a
import type { Key } from '@lichess-org/chessground/types'; // Step 3a

import { make as makeRetro, type RetroCtrl, type RetroRoot } from './retroCtrl';
import * as treeOps from './tree';
import type { LichessGameJson, TreeNode } from './tree';

// The tree plus the operations retroCtrl needs, like lila's TreeWrapper (ui/lib/src/tree/tree.ts).
export interface GameTree {
  root: TreeNode;
  nodeAtPath(path: string): TreeNode;
  pathIsMainline(path: string): boolean;
  deleteNodeAt(path: string): void;
}

function makeGameTree(root: TreeNode): GameTree {
  return {
    root,
    nodeAtPath: path => treeOps.nodeAtPath(root, path),

    // True if every step of the path follows children[0].
    pathIsMainline(path) {
      let node = root;
      for (let i = 0; i < path.length; i += 2) {
        const child = node.children[0];
        if (child?.id !== path.slice(i, i + 2)) return false;
        node = child;
      }
      return true;
    },

    // Removes the node at `path`, and everything after it, from its parent's children.
    deleteNodeAt(path) {
      const parent = treeOps.nodeAtPath(root, path.slice(0, -2));
      const id = path.slice(-2);
      parent.children = parent.children.filter(c => c.id !== id);
    },
  };
}

// Every function below is written as an arrow function (`name = (...) => ...`) rather than as
// a method, so it still works when passed around and called on its own. retroCtrl relies on
// that for redraw and toggleRetro, and the board's event handlers will in step 3.
export class AnalysisCtrl implements RetroRoot {
  readonly tree: GameTree;
  readonly mainline: TreeNode[]; // the root node, then one node per game move
  node: TreeNode; // the node the board shows
  path = ''; // the path of `node`; '' is the starting position
  retro?: RetroCtrl; // set while "Learn from your mistakes" is open
  cg?: CgApi; // Step 3a: the board; undefined in the headless scripts
  readonly redraw: () => void; // Step 4a: re-renders the page; passed in, as in lila
  private readonly orientation: Color; // your color in the game; it goes at the bottom
  private flipped = false;

  // Step 4a: redraw is passed in, like lila's AnalyseCtrl(opts, redraw). It can't be set later,
     // because retroCtrl copies root.redraw when it's created. The scripts get the default, a no-op.
  constructor(game: LichessGameJson, orientation: Color = 'white', redraw: () => void = () => {}) {
    this.tree = makeGameTree(treeOps.buildTree(game));
    this.mainline = treeOps.mainline(this.tree.root);
    this.node = this.tree.root;
    this.orientation = orientation;
    this.redraw = redraw;
  }

  bottomColor = (): Color => (this.flipped ? opposite(this.orientation) : this.orientation);

  mainlinePlyToPath = (ply: number): string => treeOps.mainlinePlyToPath(this.mainline, ply);

  // Step 3a: the board settings for the current node, like lila's makeCgOpts.
  // Step 3a/3b: the board settings for the current node, like lila's makeCgOpts.
  cgConfig = (): CgConfig => {
    const pos = positionOf(this.node);
    return {
      fen: this.node.fen,
      orientation: this.bottomColor(),
      turnColor: pos.turn,
      lastMove: this.node.uci
        ? [this.node.uci.slice(0, 2) as Key, this.node.uci.slice(2, 4) as Key]
        : undefined, // undefined clears the highlight, e.g. at the starting position
      check: pos.isCheck(),
      movable: {
        color: pos.isEnd() ? undefined : pos.turn, // as in lila's analysis board, the side to move can move
        dests: chessgroundDests(pos),
      },
    };
  };

  // Shows the node at `path`. In lila, userJump also stops autoplay and clears the board's
  // selected square, then jump() updates the board, plays sounds, and so on.
  userJump = (path: string): void => {
    const pathChanged = path !== this.path;
    this.node = this.tree.nodeAtPath(path);
    this.path = path;
    if (pathChanged) this.retro?.onJump();
    this.cg?.set(this.cgConfig()); // Step 3a: `?.` skips this when there is no board
  };

  // Plays a move from the current position and shows the result,
  // like lila's AnalyseCtrl.addNodeLocally together with tree.addNode.
  playMove = (move: Move): void => {
    const pos = positionOf(this.node);
    move = normalizeMove(pos, move); // the board sends castling as e1g1; the tree stores e1h1
    if (!pos.isLegal(move)) throw new Error(`Illegal move ${makeUci(move)} in ${this.node.fen}`);
    const id = scalachessCharPair(move);
    // If the move is already in the tree (the game move or the engine's move), reuse that node.
    // retroCtrl depends on this: it recognizes those two moves by their nodes.
    if (!this.node.children.some(c => c.id === id)) {
      const uci = makeUci(move);
      const san = makeSanAndPlay(pos, move); // also plays the move on pos
      this.node.children.push({ id, ply: this.node.ply + 1, san, uci, fen: makeFen(pos.toSetup()), children: [] });
    }
    this.userJump(this.path + id);
  };

  // The board will report moves as UCI, like "e2e4" or "e7e8q".
  playUci = (uci: string): void => {
    const move = parseUci(uci);
    if (!move) throw new Error(`Not a UCI move: "${uci}"`);
    this.playMove(move);
  };

  // Convenient for test scripts.
  playSan = (san: string): void => {
    const move = parseSan(positionOf(this.node), san);
    if (!move) throw new Error(`Could not parse "${san}" in ${this.node.fen}`);
    this.playMove(move);
  };

    // Step 3b: called by the board after you drag a piece, like lila's AnalyseCtrl.userMove.
  // Trim: lila opens a promotion chooser; this always promotes to a queen.
  userMove = (orig: Key, dest: Key): void => {
    const piece = this.cg?.state.pieces.get(dest); // the board has already moved the piece
    const promotes = piece?.role === 'pawn' && (dest[1] === '1' || dest[1] === '8');
    this.playUci(orig + dest + (promotes ? 'q' : ''));
  };

  // Step 3c: draw the move you played as a pale red arrow.
  // keep this line if you don't want the pale red arrow showing your in-game move
  // setAutoShapes = (): void => {};

    // Step 3c: draws the game's bad move as a pale red arrow while you're solving,
  // like lila's setAutoShapes and autoShape.ts.
  setAutoShapes = (): void => {
    const bad = this.retro?.showBadNode();
    this.cg?.setAutoShapes(
      bad?.uci
        ? [
            {
              orig: bad.uci.slice(0, 2) as Key,
              dest: bad.uci.slice(2, 4) as Key,
              brush: 'paleRed',
              modifiers: { lineWidth: 8 },
            },
          ]
        : [], // an empty list clears the arrow
    );
  };

  // redraw removed in step 4a-2
  // redraw = (): void => {}; // Step 4: re-render the page.

  // Like lila's flip: if "Learn from your mistakes" is open, restart it for the new bottom color.
  // That's how the panel's "Review Black's mistakes" button works.
  flip = (): void => {
    this.flipped = !this.flipped;
    this.cg?.set({ orientation: this.bottomColor() }); // Step 3a: turn the board over
    if (this.retro) this.retro = makeRetro(this, this.bottomColor());
    this.setAutoShapes(); // Step 3c
    this.redraw();
  };

  // Opens "Learn from your mistakes" for the color at the bottom of the board, or closes it.
  toggleRetro = (): void => {
    if (this.retro) this.retro = undefined;
    else this.retro = makeRetro(this, this.bottomColor());
    this.setAutoShapes();
  };
}

function positionOf(node: TreeNode): Chess {
  return Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
}