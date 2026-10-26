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

import { AnalysisSettingsCtrl } from './analysisSettings';
import { compute as computeAutoShapes } from './autoShape';
import { displayColumns, storedBooleanProp, toggle, type Toggle } from './common';
import { ForkCtrl } from './fork';
import { IdbTree } from './idbTree';
import MotifCtrl from './motif';
import Navigate from './navigate';
import { nextGlyphSymbol } from './nodeFinder';
import { analyse, evaluate, stopAnalysis, type EngineEval } from './engine';
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
  updateAt(path: string, update: (node: TreeNode) => void): void; // for idbTree
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

    // Changes the node at `path`, if there is one.
    updateAt(path, update) {
      let node: TreeNode | undefined = root;
      for (let i = 0; node && i < path.length; i += 2) node = node.children.find(c => c.id === path.slice(i, i + 2));
      if (node) update(node);
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
  readonly idbTree: IdbTree = new IdbTree(this); // which variations are folded away, for each game
  showComments = true;
  // The analysis board's settings, which "Settings" in the menu changes (analysisSettings.ts).
  // As in lila, a change redraws the board's arrows and annotations, and the page.
  readonly settings = new AnalysisSettingsCtrl(() => {
    this.setAutoShapes();
    this.redraw();
  });
  readonly motif = new MotifCtrl(this.settings); // the board marks you can switch on (motif.ts)
  settingsOpen = false; // Not in lila, which opens its dialog itself: whether the dialog is showing
  // Not in lila, which always draws the move you played in the game as a pale red arrow while
  // you look for a better one: here, only when you ask ("Show my move" in the panel), and the
  // browser remembers your choice.
  readonly showBadMoveArrow = storedBooleanProp('mistakeTrainer.showMyMove', false);
  // From lila: whether you've switched the engine on (the switch above the move list, or l). As in
  // lila, the browser remembers it, and it's off to begin with.
  private readonly cevalEnabledProp = storedBooleanProp('engine.enabled', false);
  // Not in lila: the positions the engine has analysed to the end, so going back to one doesn't
  // start again. (lila keeps the best analysis of each position in its own way.)
  private readonly analysed = new WeakSet<TreeNode>();

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
    stopAnalysis(); // Not in lila: a new card, which the engine mustn't see before it's done
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
    // like lila's asyncLoadThenShow, from initialize
    this.idbTree.load();
    this.idbTree.revealNode();
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
  visibleChildren = (node: TreeNode = this.node): TreeNode[] => {
    // Not in lila: while you solve a card, the move list stops at the card's position, and shows
    // no engine lines.
    if (this.hidingHints()) return node === this.retro!.current()!.prev.node ? [] : node.children.filter(kid => !kid.comp);
    return node.children.filter(
      kid =>
        !kid.comp ||
        (this.settings.showStaticAnalysis && !this.retro?.hideComputerLine(kid)) ||
        treeOps.contains(kid, this.node),
    );
  };

  // Not in lila: while you're solving a card, hide everything that comes from later in the game
  // or judges its moves: the moves after the position, the evals, the ?/?? marks and comments,
  // the engine lines, the eval chart, the result, and the rating changes, which say who won.
  // (In 45% of the cards, the opponent's last move is marked, which says "punish this".)
  // lila's "Learn from your mistakes" reviews a game you've just played, so it shows them; a card
  // is a puzzle. They all come back once the card is done: right first time or not, or the
  // solution viewed.
  hidingHints = (): boolean =>
    !!this.card && !!this.retro?.current() && !['win', 'view'].includes(this.retro.feedback());

  // Step 6: the eval to show beside a move, from lila's allowedEval.
  // Trim: lila prefers the local engine's eval (node.ceval) when the engine is on.
  // Not in lila: none while hiding hints.
  allowedEval = (node: TreeNode = this.node): TreeNode['eval'] | false =>
    this.settings.showStaticAnalysis && !this.hidingHints() && node.eval;

  // Step 6: from lila's showMoveGlyphs. Trim: lila also shows them in studies.
  // Not in lila: none while hiding hints.
  showMoveGlyphs = (): boolean => this.settings.showStaticAnalysis && !this.hidingHints();

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
    this.idbTree.revealNode(); // like lila's setPath
    this.onMainline = this.tree.pathIsMainline(path);
    if (pathChanged) this.retro?.onJump();
    this.cg?.set(this.cgConfig()); // Step 3a: `?.` skips this when there is no board
    this.setAutoShapes(); // like lila's showGround, which jump calls
    if (pathChanged) this.startCeval(); // like lila's jump
  };

  // Step 8: from lila. Jump to the game's move at `ply`.
  jumpToMain = (ply: number): void => this.userJump(this.mainlinePlyToPath(ply));

  // Step 8: from lila, for the advice summary: the next move by `color` marked `symbol`.
  jumpToGlyphSymbol = (color: Color, symbol: string): void => {
    const node = nextGlyphSymbol(color, symbol, this.mainline, this.node.ply);
    if (node) this.jumpToMain(node.ply);
    this.redraw();
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

  // Not in lila: "Show my move" / "Hide my move" in the panel.
  toggleBadMoveArrow = (): void => {
    this.showBadMoveArrow(!this.showBadMoveArrow());
    this.setAutoShapes();
    this.redraw();
  };

  // Like lila's setAutoShapes: the arrows and annotations the board draws by itself (autoShape.ts).
  // An empty list clears what was drawn.
  setAutoShapes = (): void => this.cg?.setAutoShapes(computeAutoShapes(this));

  // From lila: whether evaluations show (the gauge, the best move arrows): Lichess's analysis, or
  // the engine's while it's on. Not in lila: never while you're solving a card (hidingHints).
  showEvaluation = (): boolean => !this.hidingHints() && (this.settings.showStaticAnalysis || this.cevalEnabled());

  // From lila: whether the engine may run. Not in lila: never while you're solving a card, when it
  // would give the answer away. Trim: lila checks the game isn't being played, and studies' rules.
  isCevalAllowed = (): boolean => !this.hidingHints();

  // From lila: whether the engine is on, and with a value, switches it on or off.
  // Trim: lila's can be forced on, for its practice mode and the move check, which has its own
  // way here (evaluateNode).
  cevalEnabled = (enable?: boolean): boolean => {
    const state = this.cevalEnabledProp() && this.isCevalAllowed();
    if (enable === undefined) return state;
    // Not in lila: while you're solving, switching it (l) does nothing. It reads as off then, so
    // l would otherwise switch it on for later.
    if (!this.isCevalAllowed()) return false;
    this.cevalEnabledProp(enable);
    if (enable !== state) {
      if (enable) this.startCeval();
      else stopAnalysis();
      this.setAutoShapes();
      this.redraw();
    }
    return enable;
  };

  // From lila: the engine analyses the position on the board, if it's on (engine.ts). node.ceval
  // follows the search as it goes deeper; the gauge, the arrows, and the engine's box show it.
  // Trim: lila also uses the analyses Lichess keeps in the cloud, and skips threefold repetitions.
  startCeval = (): void => {
    const node = this.node;
    if (!this.cevalEnabled() || this.analysed.has(node) || positionOf(node).isEnd()) return;
    const update = (ceval: EngineEval) => {
      node.ceval = ceval;
      if (node !== this.node) return;
      this.setAutoShapes();
      this.redraw();
    };
    analyse(node.fen, update, ceval => {
      if (ceval.bestmove) this.analysed.add(node);
      update(ceval);
    });
  };

  // From lila: plays a line of moves, e.g. the engine's up to the move you click.
  playUciList = (ucis: string[]): void => ucis.forEach(this.playUci);

  // From lila: the evaluation gauge beside the board (evalGauge.ts), if there's an evaluation to
  // show, and not on a phone (one column), nor after the game ended in that position.
  // Trim: lila also checks the engine is allowed here, and shows it whenever its engine is on.
  showEvalGauge = (): boolean =>
    this.settings.showGauge &&
    displayColumns() > 1 &&
    this.showEvaluation() &&
    (this.cevalEnabled() || !!this.node.eval || !!this.node.ceval) &&
    !positionOf(this.node).outcome();

  // From lila: the best move arrows (autoShape.ts), unless "Learn from your mistakes" is hiding
  // the engine's line here.
  showBestMoveArrows = (): boolean =>
    this.settings.showBestMoveArrows && !this.retro?.hideComputerLine(this.node);

  // From lila: the best move from here according to Lichess's analysis, which it gives on the
  // judged move that follows in the game (treeOps.withMainlineChild).
  nextNodeBest = (): string | undefined => this.node.children[0]?.eval?.best;

  // From lila: annotations on the board, when the setting is on, and not while you're solving
  // (showMoveGlyphs is false then too: AnalysisCtrl.hidingHints).
  showMoveAnnotations = (): boolean =>
    this.settings.showMoveAnnotationsOnBoard && !this.retro?.isSolving() && this.showMoveGlyphs();

  // From lila: the variation arrows (autoShape.ts), when the setting is on and there's a move from
  // here. Only the moves the move list shows get one, so not an engine line it hides.
  showVariationArrows = (): boolean => {
    if (!this.allowLines() || !this.settings.showVariationArrows) return false;
    return Boolean(this.node.children.filter(x => !x.comp || this.settings.showStaticAnalysis).length);
  };

  // From lila: whether the board may show lines of moves: not while you're solving.
  // Trim: lila also checks studies' rules.
  allowLines = (): boolean => !this.retro?.isSolving();

  // From lila: whether the board marks (motif.ts) may show: not while you're solving. autoShape.ts
  // also only draws them where the engine is allowed (isCevalAllowed), which covers every moment a
  // card is unsolved. Trim: lila also checks studies' rules, and that the variant has them.
  motifEnabled = (): boolean => !this.retro?.isSolving();

  // redraw removed in step 4a-2
  // redraw = (): void => {}; // Step 4: re-render the page.

  // Not in lila, whose engine evaluates every position the board shows: Stockfish evaluates
  // a move retroCtrl has to check (engine.ts). node.ceval follows the search as it goes deeper,
  // as in lila, and retroCtrl judges the move once the engine has searched enough.
  evaluateNode = (node: TreeNode): void => {
    const update = (ceval: TreeNode['ceval']) => {
      node.ceval = ceval;
      this.retro?.onCeval();
      this.startCeval(); // once the move is judged right, the card is done, and the engine may start
      this.redraw();
    };
    evaluate(node.fen, update).then(update, (e: Error) => alert(`Stockfish couldn't check your move: ${e.message}`));
  };

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

  // Not in lila, whose dialog opens and closes itself (showSettingsDialog): the menu's Settings
  // dialog (analysisSettingsView.ts) is part of the page, shown while settingsOpen is true.
  openSettings = (): void => {
    this.settingsOpen = true;
    this.redraw();
  };
  closeSettings = (): void => {
    this.settingsOpen = false;
    this.redraw();
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