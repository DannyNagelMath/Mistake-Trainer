// analysisCtrl.ts: the object retroCtrl calls `root`. It holds the tree and the position the
// board shows, and implements RetroRoot. It plays the role of lila's AnalyseCtrl
// (ui/analyse/src/ctrl.ts); steps 2-4 will add the board and page rendering to it.

import { opposite, parseUci, makeUci, type Color, type Move } from 'chessops';
import { Chess, normalizeMove } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { scalachessCharPair } from 'chessops/compat';

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
  private readonly orientation: Color; // your color in the game; it goes at the bottom
  private flipped = false;

  constructor(game: LichessGameJson, orientation: Color = 'white') {
    this.tree = makeGameTree(treeOps.buildTree(game));
    this.mainline = treeOps.mainline(this.tree.root);
    this.node = this.tree.root;
    this.orientation = orientation;
  }

  bottomColor = (): Color => (this.flipped ? opposite(this.orientation) : this.orientation);

  mainlinePlyToPath = (ply: number): string => treeOps.mainlinePlyToPath(this.mainline, ply);

  // Shows the node at `path`. In lila, userJump also stops autoplay and clears the board's
  // selected square, then jump() updates the board, plays sounds, and so on.
  userJump = (path: string): void => {
    const pathChanged = path !== this.path;
    this.node = this.tree.nodeAtPath(path);
    this.path = path;
    if (pathChanged) this.retro?.onJump();
    // Step 3: update the board here.
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

  setAutoShapes = (): void => {}; // Step 3: draw the move you played as a pale red arrow.

  redraw = (): void => {}; // Step 4: re-render the page.

  // Like lila's flip: if "Learn from your mistakes" is open, restart it for the new bottom color.
  // That's how the panel's "Review Black's mistakes" button works.
  flip = (): void => {
    this.flipped = !this.flipped;
    if (this.retro) this.retro = makeRetro(this, this.bottomColor());
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