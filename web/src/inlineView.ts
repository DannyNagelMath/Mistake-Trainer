// inlineView.ts: the move list written as a paragraph, with variations in brackets. From lila's
// ui/analyse/src/treeView/inlineView.ts (master, commit 27ffc8b). lila shows it when you choose
// "inline notation"; the default two-column list (columnView.ts) is built on top of it.
// Every change from lila's version is marked with a comment starting "Trim:".
//
// This is where engine lines stay hidden while you solve: the list only shows the moves that
// ctrl.visibleChildren returns, and commentNodes swaps "Mistake. Nf3 was best." for
// "Learn from this mistake".

import type { Classes, VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderMoveNodes, renderIndex } from './components';
import { i18n } from './i18n';
import { hl, type LooseVNodes } from './snabbdom';
import { hasBranching, type TreeComment, type TreeNode } from './tree';

// ---------- Stand-in for lila's idbTree.discloseOf (ui/analyse/src/idbTree.ts) ----------

// 'expanded' means a node's variations or comments break up the list, and 'collapsed' that you
// folded them away. Trim: lila remembers folded variations in IndexedDB. You can only fold them
// in "disclosure mode", which is off by default, so nothing here is ever 'collapsed'.
export type DiscloseState = undefined | 'expanded' | 'collapsed';

export function discloseOf(ctrl: AnalysisCtrl, node: TreeNode | undefined, isMainline: boolean): DiscloseState {
  if (!node) return undefined;
  return isCollapsible(ctrl, node, isMainline) ? 'expanded' : undefined;
}

function isCollapsible(ctrl: AnalysisCtrl, node: TreeNode, isMainline: boolean): boolean {
  const [first, second, third] = node.children.filter(n => ctrl.settings.showStaticAnalysis || !n.comp);
  return Boolean(
    // Trim: lila also checks first?.forceVariation, a study feature.
    third ||
      (second && hasBranching(second, 6)) ||
      (isMainline && ctrl.treeView.mode === 'column' && (second || first?.comments?.filter(Boolean).length)),
  );
}

// ---------- Everything below is lila's code except where marked ----------

export function renderInlineView(ctrl: AnalysisCtrl): VNode {
  const renderer = new InlineView(ctrl);
  const parentNode = ctrl.tree.root;
  const parentDisclose = discloseOf(ctrl, parentNode, true);
  return hl(
    'div.tview2.tview2-inline',
    { class: { anchor: !!parentDisclose } }, // Trim: lila hides the list until IndexedDB has loaded.
    [
      renderer.commentNodes(parentNode),
      renderer.renderNodes(ctrl.visibleChildren(parentNode), {
        parentPath: '',
        parentNode,
        parentDisclose,
        isMainline: true,
      }),
    ],
  );
}

// Trim: lila's Args also has `conceal`, which hides moves a broadcast hasn't revealed yet.
export interface Args {
  isMainline: boolean;
  parentPath: string;
  parentNode: TreeNode;
  parentDisclose?: DiscloseState;
  parenthetical?: boolean;
}

export class InlineView {
  readonly inline: boolean = true;
  // CSS classes for glyph ids 1 to 6, e.g. id 2 (?) gives the move the class 'mistake'.
  private readonly glyphs = ['good', 'mistake', 'brilliant', 'blunder', 'interesting', 'inaccuracy'];

  constructor(readonly ctrl: AnalysisCtrl) {}

  renderNodes([child, ...siblings]: TreeNode[], args: Args): LooseVNodes {
    if (!child) return undefined;
    const { parentDisclose } = args;
    // Trim: lila first checks child.forceVariation, a study feature.
    return [
      this.moveNode(child, args),
      parentDisclose !== 'collapsed' && [
        this.commentNodes(child),
        siblings[0] && hl('interrupt', this.lines(siblings, args)),
      ],
      this.renderNodes(this.ctrl.visibleChildren(child), this.childArgs(child, args, true)),
    ];
  }

  commentNodes(node: TreeNode, classes: Classes = {}): LooseVNodes[] {
    if (!this.ctrl.showComments || !node.comments) return [];
    return node.comments
      .map(comment =>
        this.ctrl.retro?.hideComputerLine(node) && this.isLichessComment(comment)
          ? hl('comment', i18n.site.learnFromThisMistake)
          : (!this.isLichessComment(comment) || this.ctrl.settings.showStaticAnalysis) &&
            hl(
              'comment',
              {
                class: {
                  inaccuracy: comment.text.startsWith('Inaccuracy.'),
                  mistake:
                    comment.text.startsWith('Mistake.') ||
                    comment.text.startsWith('Checkmate is now unavoidable.'),
                  blunder: comment.text.startsWith('Blunder.'),
                  ...classes,
                },
              },
              // Trim: lila names the author when a move has several comments (in studies), and turns
              // moves, links, and @names in the text into links (enrichText).
              [hl('span', comment.text)],
            ),
      )
      .filter(Boolean);
  }

  private isLichessComment(comment: TreeComment): boolean {
    return comment.by === 'lichess' && comment.text.endsWith(' was best.');
  }

  protected lines(lines: TreeNode[], args: Args): LooseVNodes {
    const { parentDisclose, parentPath, parentNode, isMainline } = args;
    if (!lines.length || parentDisclose === 'collapsed') return undefined;
    const anchor = parentDisclose === 'expanded' && (this.inline || !isMainline);
    const lineArgs = { parentPath, parentNode, isMainline: false };

    return (!isMainline || this.inline) && args.parenthetical
      ? hl('inline', this.sidelineNodes(lines, lineArgs))
      : hl('lines', { class: { anchor } }, [
          // Trim: lila draws a line to the fold button here in disclosure mode.
          lines.map(line => hl('line', [parentDisclose && hl('branch'), this.sidelineNodes([line], lineArgs)])),
        ]);
  }

  private sidelineNodes([child, ...siblings]: TreeNode[], args: Args): LooseVNodes {
    if (!child) return undefined;
    const childArgs = this.childArgs(child, args, false);
    // Trim: lila's disclosure mode (off by default) lists every variation separately.
    return [
      this.moveNode(child, args),
      this.commentNodes(child),
      args.parenthetical && this.lines(siblings, args),
      child.children.length < 2 || childArgs.parenthetical
        ? this.sidelineNodes(child.children, childArgs)
        : this.lines(child.children, childArgs),
      !args.parenthetical && this.lines(siblings, args),
    ];
  }

  private childArgs(child: TreeNode, args: Args, isMainline = false): Args {
    return {
      isMainline,
      parentPath: args.parentPath + child.id,
      parentNode: child,
      parentDisclose: discloseOf(this.ctrl, child, false),
      parenthetical: this.parenthetical(child),
    };
  }

  // A single short variation, which is written in brackets within the line rather than below it.
  private parenthetical(node: TreeNode): boolean {
    const [, second, third] = node.children;
    return !third && !!second && !hasBranching(second, 6);
  }

  protected moveNode(node: TreeNode, { isMainline, parentPath, parentNode, parenthetical }: Args): LooseVNodes {
    const { ctrl } = this;
    const path = parentPath + node.id;
    // The move to highlight as "current": the position of the mistake you're solving.
    // Trim: lila first checks for a game in progress and for a broadcast's latest move.
    const currentPath = ctrl.retro?.current()?.prev.path;
    const withIndex =
      (!isMainline || this.inline) &&
      (node.ply % 2 === 1 ||
        (!isMainline &&
          parentNode.children.length > 1 &&
          (!parenthetical || parentNode.children[0] !== node))); // ugh
    const classes: Classes = {
      mainline: isMainline && this.inline,
      active: path === ctrl.path,
      current: path === currentPath,
      nongame: !currentPath && !!ctrl.gamePath && path.startsWith(ctrl.gamePath) && path !== ctrl.gamePath,
      // Trim: no conceal/hide (broadcasts), context-menu, pending-deletion, or pending-copy classes yet.
    };
    const glyphs = [...(node.glyphs ?? [])]; // Trim: lila adds glyphs from live annotation here.
    if (ctrl.showMoveGlyphs()) {
      glyphs
        .map(g => this.glyphs[g.id - 1])
        .filter(Boolean)
        .forEach(cls => (classes[cls] = true));
    }
    return hl('move', { attrs: { p: path }, class: classes }, [
      // Trim: lila puts a fold button here in disclosure mode.
      withIndex && renderIndex(node.ply, true),
      renderMoveNodes(node, isMainline && !this.inline, ctrl.showMoveGlyphs(), ctrl.allowedEval(node) || false, glyphs),
    ]);
  }
}
