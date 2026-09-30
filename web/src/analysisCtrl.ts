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

import { toggle, type Toggle } from './common';
import { ForkCtrl } from './fork';
import Navigate from './navigate';
import { make as makeRetro, type RetroCardOpts, type RetroCtrl, type RetroRoot } from './retroCtrl';
import * as treeOps from './tree';
import { TreeView } from './treeView';
import type { LichessGameJson, TreeNode } from './tree';

// The tree plus the operations retroCtrl needs, like lila's TreeWrapper (ui/lib/src/tree/tree.ts).
export interface GameTree {
  root: TreeNode;
  nodeAtPath(path: string): TreeNode;
  getNodeList(path: string): TreeNode[]; // Step 7
  pathIsMainline(path: string): boolean;
  deleteNodeAt(path: string): void;
}

function makeGameTree(root: TreeNode): GameTree {
  return {
    root,
    nodeAtPath: path => treeOps.nodeAtPath(root, path),

    // Step 7: the root, then each node along the path, ending with the node at `path`.
    getNodeList(path) {
      const nodes = [root];
      for (let i = 2; i <= path.length; i += 2) nodes.push(treeOps.nodeAtPath(root, path.slice(0, i)));
      return nodes;
    },

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
// Step 9: the fields marked `!` are set in initialize, which the constructor calls.
export class AnalysisCtrl implements RetroRoot {
  tree!: GameTree;
  mainline!: TreeNode[]; // the root node, then one node per game move
  node!: TreeNode; // the node the board shows
  path!: string; // the path of `node`; '' is the starting position
  nodeList!: TreeNode[]; // Step 7: the root, then each node along `path`, ending with `node`
  onMainline!: boolean; // Step 7: whether `path` follows the game's moves
  retro?: RetroCtrl; // set while "Learn from your mistakes" is open
  cg?: CgApi; // Step 3a: the board; undefined in the headless scripts
  readonly redraw: () => void; // Step 4a: re-renders the page; passed in, as in lila
  private orientation!: Color; // your color in the game; it goes at the bottom
  private flipped!: boolean;
  card?: RetroCardOpts; // Step 9: set when reviewing a card from the deck
  // Step 9: like lila's cgVersion.js. Raising it makes the next redraw replace the board with a
  // new one (see renderGround in view.ts). Trim: lila also keeps cgVersion.dom, to tell when
  // the new board exists; we never use the board in between.
  cgVersion = 1;

  // Step 6: for the move list.
  game!: LichessGameJson; // lila keeps the game's details in ctrl.data.game
  gamePath!: string; // the path of the game's last move
  readonly treeView: TreeView;
  showComments = true;
  // Trim: lila's SettingsCtrl, which the user changes in the analysis settings menu.
  // These are lila's defaults. Step 7: shift+i switches `inline`.
  readonly settings = {
    inline: false, // two-column move list, rather than a paragraph
    showStaticAnalysis: true, // show the server analysis: evals, glyphs, comments, engine lines
  };

  // Step 7: navigation and the menu.
  fork!: ForkCtrl; // the choice of continuations shown under the move list
  readonly navigate: Navigate; // first / prev / next / last, for the buttons, keys, and scroll wheel
  readonly actionMenu: Toggle = toggle(false); // whether the ☰ menu is open

  // Step 4a: redraw is passed in, like lila's AnalyseCtrl(opts, redraw). It can't be set later,
  // because retroCtrl copies root.redraw when it's created. The scripts get the default, a no-op.
  // Step 9: `card` is for reviewing a card from the deck.
  constructor(
    game: LichessGameJson,
    orientation: Color = 'white',
    redraw: () => void = () => {},
    card?: RetroCardOpts,
  ) {
    this.redraw = redraw;
    this.treeView = new TreeView(this);
    this.navigate = new Navigate(this);
    this.initialize(game, orientation, card);
  }

  // Step 9: set up for a game, like lila's initialize, which its constructor calls too.
  // Trim: lila reads the orientation from the game data.
  private initialize(game: LichessGameJson, orientation: Color, card: RetroCardOpts | undefined): void {
    this.game = game;
    this.tree = makeGameTree(treeOps.buildTree(game));
    this.mainline = treeOps.mainline(this.tree.root);
    this.gamePath = this.mainline.map(n => n.id).join('');
    this.fork = new ForkCtrl(this);
    this.orientation = orientation;
    this.flipped = false;
    this.card = card;
    // lila's setPath(root), from reloadData or the constructor.
    this.node = this.tree.root;
    this.path = '';
    this.nodeList = [this.tree.root];
    this.onMainline = true;
  }

  // Step 9: show another game, like lila's reloadData, which studies use to change chapter.
  // It closes "Learn from your mistakes" and the menu; the caller opens the panel again if needed.
  loadGame = (game: LichessGameJson, orientation: Color, card?: RetroCardOpts): void => {
    this.retro = undefined;
    this.actionMenu(false);
    this.initialize(game, orientation, card);
    this.cgVersion++;
  };

  bottomColor = (): Color => (this.flipped ? opposite(this.orientation) : this.orientation);

  mainlinePlyToPath = (ply: number): string => treeOps.mainlinePlyToPath(this.mainline, ply);

  // Step 5: for the retro panel, which says "Waiting for analysis" until this is true.
  // Trim: lila checks for an eval on the root node. The API's analysis starts after the first
  // move, so our root never has one; this checks the first move instead.
  hasFullComputerAnalysis = (): boolean => !!this.mainline[1]?.eval;

  // Step 6: the moves after `node` that the move list shows, from lila's visibleChildren.
  // An engine line is hidden while its mistake is unsolved, unless the board is on it.
  // Trim: lila also shows it if the engine is checking your move (retro.forceCeval), which needs the engine.
  visibleChildren = (node: TreeNode = this.node): TreeNode[] =>
    node.children.filter(
      kid =>
        !kid.comp ||
        (this.settings.showStaticAnalysis && !this.retro?.hideComputerLine(kid)) ||
        treeOps.contains(kid, this.node),
    );

  // Step 6: the eval to show beside a move, from lila's allowedEval.
  // Trim: lila prefers the local engine's eval (node.ceval) when the engine is on.
  allowedEval = (node: TreeNode = this.node): TreeNode['eval'] | false =>
    this.settings.showStaticAnalysis && node.eval;

  // Step 6: from lila's showMoveGlyphs. Trim: lila also shows them in studies.
  showMoveGlyphs = (): boolean => this.settings.showStaticAnalysis;

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
    // Step 6: like lila's jump, scroll the move list to the new move: smoothly if it's close.
    if (pathChanged) this.treeView.requestAutoScroll(treeOps.distance(this.path, path) > 8 ? 'instant' : 'smooth');
    this.node = this.tree.nodeAtPath(path);
    this.path = path;
    this.nodeList = this.tree.getNodeList(path); // Step 7: like lila's setPath
    this.onMainline = this.tree.pathIsMainline(path);
    if (pathChanged) this.retro?.onJump();
    this.cg?.set(this.cgConfig()); // Step 3a: `?.` skips this when there is no board
  };

  // Step 7: like lila's userJumpIfCan. Trim: lila checks that a study allows the jump, and can
  // start the board's animation from the parent move when stepping between variations (sideStep).
  userJumpIfCan = (path: string): void => {
    if (path === this.path) return;
    this.userJump(path);
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
    this.redraw(); // Step 5: like the end of lila's addNode, so the panel shows the result of the move
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
  // Step 9: not in card mode, where the card's mistake stays on even with the board turned over.
  flip = (): void => {
    this.flipped = !this.flipped;
    this.cg?.set({ orientation: this.bottomColor() }); // Step 3a: turn the board over
    if (this.retro && !this.card) {
      // Fix: lila doesn't clear this.retro first. While the new retro is starting up, it jumps to
      // its first mistake, and userJump tells the OLD retro about that jump. If the old one is
      // solving a mistake on exactly that move (e.g. black's mistake at ply 38, when white's first
      // is at ply 39), it takes the jump as the game move played, calls onFail, and jumps back.
      // Clearing it also means the new retro's first redraw removes the panel, so the panel is
      // built again with buttons wired to the new retro; the buttons are wired when inserted.
      this.retro = undefined;
      this.retro = makeRetro(this, this.bottomColor());
    }
    this.setAutoShapes(); // Step 3c
    this.redraw();
  };

  // Opens "Learn from your mistakes" for the color at the bottom of the board, or closes it.
  toggleRetro = (): void => {
    if (this.retro) this.retro = undefined;
    else {
      this.actionMenu(false); // Step 7: lila's closeTools. Trim: it also closes the explorer and practice mode.
      // Step 9: in card mode, always your color, even with the board turned over.
      this.retro = makeRetro(this, this.card ? this.orientation : this.bottomColor());
    }
    this.setAutoShapes();
  };

  // Step 7: from lila. Trim: lila closes the opening explorer when opening the menu.
  toggleActionMenu = (): void => {
    this.actionMenu.toggle();
  };

  // Step 7: which tool is open from the controls bar, if any. Trim: lila's can also be the opening explorer.
  activeControlBarTool = (): 'action-menu' | false => (this.actionMenu() ? 'action-menu' : false);

  // Step 7: which mode the tools column is in. Trim: lila's can also be 'practice', 'ceval'
  // (engine lines shown), or 'learn-practice' (a practice study).
  activeControlMode = (): 'retro' | false => (this.retro ? 'retro' : false);
}

function positionOf(node: TreeNode): Chess {
  return Chess.fromSetup(parseFen(node.fen).unwrap()).unwrap();
}