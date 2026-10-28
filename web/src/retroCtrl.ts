// retroCtrl.ts: the "Learn from your mistakes" state machine, trimmed from lila's
// ui/analyse/src/retrospect/retroCtrl.ts (master, commit 27ffc8b).
// Every change from lila's version is marked with a comment starting "Trim:", except card
// mode (reviewing a single mistake from the deck), whose additions are marked "Step 9:", and
// other additions, marked "Not in lila:".

import type { Color } from 'chessops';

import { evalSwings } from './nodeFinder';
import type { TreeNode } from './tree';
import * as winningChances from './winningChances';

// ---------- Stand-ins for things lila provides globally or in its lib ----------

// Trim: lila declares these types globally in ui/@types/lichess/index.d.ts.
type Ply = number; // half-move count: ply 1 is White's first move
type Uci = string; // a move in UCI notation, e.g. "e2e4"
type Redraw = () => void;

// Trim: copied from lila's ui/lib/src/common.ts.
// A Prop is a stored value you read with p() and set with p(newValue).
export type Prop<T> = {
  (): T;
  (v: T): T;
};
const defined = <T>(value: T | undefined): value is T => value !== undefined;
const prop = <A>(initialValue: A): Prop<A> => {
  let value = initialValue;
  return (v?: A) => {
    if (defined(v)) value = v;
    return value;
  };
};
const isEmpty = <T>(a: T[] | undefined): boolean => !a || a.length === 0;

// Trim: lila passes its whole AnalyseCtrl as `root`. This interface lists only what
// retroCtrl uses; your adapter (step 1c) provides it.
// Note: retroCtrl stores root.redraw and root.toggleRetro and calls them later on
// their own, so the adapter must define them as arrow functions (as lila does).
export interface RetroRoot {
  mainline: TreeNode[]; // the root node, then one node per game move
  node: TreeNode; // the node currently shown on the board
  path: string; // the path of `node`
  tree: {
    nodeAtPath(path: string): TreeNode;
    pathIsMainline(path: string): boolean;
    deleteNodeAt(path: string): void;
  };
  mainlinePlyToPath(ply: Ply): string;
  userJump(path: string): void; // show `path`; if the path changed, call retro.onJump()
  setAutoShapes(): void; // redraw the arrows on the board
  redraw: Redraw;
  flip(): void; // flip the board; if retro is open, restart it for the new bottom color
  toggleRetro(): void; // open or close "Learn from your mistakes"
  // Not in lila, whose engine evaluates every position the board shows: start Stockfish on a
  // move to check. It sets node.ceval as it searches, and calls retro.onCeval each time.
  evaluateNode(node: TreeNode): void;
  card?: RetroCardOpts; // Step 9: set when reviewing a card, rather than a whole game
}

// Step 9: not in lila. In card mode, retroCtrl shows one given mistake. The game's other
// mistakes still count as candidates, so their engine lines stay hidden in the move list.
// When the card is done (solved, solution viewed, or skipped), "Next" deals the next card.
export interface RetroCardOpts {
  ply: Ply; // the mistake to show: the ply of the move that was played
  next(): boolean; // deal the next card; false when nothing more is due
  restart(): void; // look for more cards, for the button at the end
  summary(): string; // for the end of the session
  // Called with each outcome: the right move ('win'), a wrong one ('fail'), "View the solution"
  // ('view'), or "Skip this move" ('skip'). The deck grades the card on the first one.
  onResult(result: CardResult): void;
  // After the right first move, the buttons for saying how it went: a label, and what clicking
  // it does. Undefined once the card is graded, and in every other case.
  ratingChoices(): { label: string; rate: () => void }[] | undefined;
  suspend(): void; // "Suspend card": it never comes up again; the next card is dealt
  openingUcis: Uci[]; // moves masters have played from the position, accepted as right answers
  bestMoveOnly(): boolean; // only the analysis's best move counts, not any move nearly as good
}

export type CardResult = 'win' | 'fail' | 'view' | 'skip'; // Step 9

// ---------- Everything below is lila's code except where marked ----------

export interface RetroCtrl {
  isSolving(): boolean;
  current: Prop<Retrospection | null>;
  feedback: Prop<Feedback>;
  color: Color;
  isPlySolved(ply: Ply): boolean;
  onJump(): void;
  jumpToNext(): void;
  skip(): void;
  viewSolution(): void;
  hideComputerLine(node: TreeNode): boolean;
  showBadNode(): TreeNode | undefined;
  onCeval(): void;
  onMergeAnalysisData(): void;
  completion(): [number, number];
  reset(): void;
  flip(): void;
  preventGoingToNextMove(): boolean;
  close(): void;
  node(): TreeNode;
  redraw: Redraw;
  forceCeval(): boolean;
  card?: RetroCardOpts; // Step 9
}

interface NodeWithPath {
  node: TreeNode;
  path: string;
}

interface Retrospection {
  fault: NodeWithPath;
  prev: NodeWithPath;
  solution: NodeWithPath;
  openingUcis: Uci[];
}

type Feedback = 'find' | 'eval' | 'win' | 'fail' | 'view' | 'offTrack';

export function make(root: RetroRoot, color: Color): RetroCtrl {
  // Trim: removed `const game = root.data.game;` (only the opening lookup used it).
  let candidateNodes: TreeNode[] = [];
  const explorerCancelPlies: number[] = []; // stays empty until the opening lookup is added back
  let solvedPlies: number[] = [];
  const current = prop<Retrospection | null>(null);
  const feedback = prop<Feedback>('find');
  const card = root.card; // Step 9

  function safeRedraw() {
    root.redraw(); // Trim: lila skips this in blind mode.
  }

  // TODO these functions return false positives for variation plies.
  const isPlySolved = (ply: Ply): boolean => solvedPlies.includes(ply);
  const isPlyLearnCandidate = (ply: Ply): boolean => candidateNodes.some(n => n.ply === ply);

  function findNextNode(): TreeNode | undefined {
    const colorModulo = color === 'white' ? 1 : 0;
    candidateNodes = evalSwings(
      root.mainline,
      n => n.ply % 2 === colorModulo && !explorerCancelPlies.includes(n.ply),
    );
    return candidateNodes.find(n => !isPlySolved(n.ply) && (!card || n.ply === card.ply)); // Step 9: in card mode, only the card's
  }

  function jumpToNext(): void {
    feedback('find');
    const node = findNextNode();
    if (!node) {
      if (card?.next()) return; // Step 9: this card is done; the next one takes over
      current(null);
      return safeRedraw();
    }
    const fault = {
      node,
      path: root.mainlinePlyToPath(node.ply),
    };
    const prevPath = fault.path.slice(0, -2); // Trim: lila calls treePath.init, which drops the last 2-char id.
    const prev = {
      node: root.tree.nodeAtPath(prevPath),
      path: prevPath,
    };
    const solutionNode = prev.node.children.find(n => !!n.comp)!;
    current({
      fault,
      prev,
      solution: {
        node: solutionNode,
        path: prevPath + solutionNode.id,
      },
      openingUcis: card?.openingUcis ?? [], // Step 9: a card brings them (deck.ts masterMoves)
    });
    // Trim: removed the opening explorer lookup. Lichess fetches master games for
    // opening positions, skips the mistake if the played move appears there, and
    // otherwise stores those moves in openingUcis to accept as correct answers.
    // Step 9: for cards, scripts/buildDeck.ts does that lookup when it builds the deck.
    root.userJump(prev.path);
    safeRedraw();
  }

  function onJump(): void {
    const node = root.node,
      fb = feedback(),
      cur = current();
    if (!cur) return;
    if (
      (fb === 'eval' && cur.fault.node.ply !== node.ply) ||
      (fb === 'offTrack' && cur.prev.path === root.path)
    ) {
      feedback('find');
      root.setAutoShapes();
      return;
    }
    if (isSolving() && cur.fault.node.ply === node.ply) {
      if (cur.openingUcis.includes(node.uci!) || node.san?.endsWith('#') || node.comp)
        onWin(); // found in opening explorer, checkmate ends the game, or comp solution line
      else if (node.eval)
        onFail(); // the move that was played in the game
      else if (card?.bestMoveOnly())
        onFail(); // Not in lila: only the analysis's best move counts (your training settings)
      else {
        feedback('eval');
        // Not in lila: there, the engine is already on the move. And here, the position before it
        // too, as the move is compared with that (checkCeval); once per card, as the engine
        // remembers the positions it has checked.
        root.evaluateNode(cur.prev.node);
        root.evaluateNode(node);
        checkCeval();
      }
    } else if (isSolving() && cur.prev.path !== root.path) feedback('offTrack');
    root.setAutoShapes();
  }

  // Trim: lila lets other pages (api.overrides) say when the engine has searched enough.
  const isCevalReady = (node: TreeNode): boolean => {
    if (!node.ceval) return false;
    return Boolean(node.ceval.bestmove || node.ceval.nodes >= 1_000_000 || (node.ceval.millis ?? 0) > 3000);
  };

  function checkCeval(): void {
    const node = root.node,
      cur = current();
    if (!cur || feedback() !== 'eval' || cur.fault.node.ply !== node.ply) return;
    // Not in lila, which compares the move with the game's computer analysis of the position before
    // it (prev.node.eval): here, with our engine's evaluation of that position, searched as far as
    // the move. Our engine doesn't always agree with the computer analysis, which was another search,
    // and the difference alone could decide whether a move counts; with the same engine on both
    // sides, it can't.
    if (isCevalReady(node) && isCevalReady(cur.prev.node)) {
      const diff = winningChances.povDiff(color, node.ceval!, cur.prev.node.ceval!);
      if (diff > -0.04) onWin();
      else onFail();
    }
  }

  function onWin(): void {
    card?.onResult('win'); // Step 9
    solveCurrent();
    // Trim: removed `if (site.blindMode) jumpToNext();`
    feedback('win');
    safeRedraw();
  }

  function onFail(): void {
    card?.onResult('fail'); // Step 9
    feedback('fail');
    const bad = {
      node: root.node,
      path: root.path,
    };
    root.userJump(current()!.prev.path);
    if (!root.tree.pathIsMainline(bad.path) && isEmpty(bad.node.children)) root.tree.deleteNodeAt(bad.path);
    safeRedraw();
  }

  function viewSolution() {
    card?.onResult('view'); // Step 9
    feedback('view');
    root.userJump(current()!.solution.path);
    solveCurrent();
  }

  function skip() {
    card?.onResult('skip'); // Step 9
    solveCurrent();
    jumpToNext();
  }

  function solveCurrent() {
    if (current()) solvedPlies.push(current()!.fault.node.ply);
  }

  const hideComputerLine = (node: TreeNode): boolean =>
    isPlyLearnCandidate(node.ply) && !isPlySolved(node.ply);

  function showBadNode(): TreeNode | undefined {
    const cur = current();
    return cur && isSolving() && cur.prev.path === root.path ? cur.fault.node : undefined;
  }

  const isSolving = (): boolean => ['find', 'fail'].includes(feedback());

  jumpToNext();

  function onMergeAnalysisData() {
    if (isSolving() && !current()) jumpToNext();
  }

  return {
    current,
    color,
    isPlySolved,
    onJump,
    jumpToNext,
    skip,
    viewSolution,
    hideComputerLine,
    showBadNode,
    onCeval: checkCeval,
    onMergeAnalysisData,
    feedback,
    isSolving,
    completion: () => [solvedPlies.length, candidateNodes.length],
    reset() {
      solvedPlies = [];
      jumpToNext();
    },
    flip() {
      root.flip(); // Trim: lila handles the Racing Kings variant separately here.
    },
    preventGoingToNextMove: () => {
      const cur = current();
      return isSolving() && !!cur && root.path === cur.prev.path;
    },
    close: root.toggleRetro,
    node: () => root.node,
    redraw: root.redraw,
    forceCeval: () => feedback() === 'eval',
    card, // Step 9
  };
}