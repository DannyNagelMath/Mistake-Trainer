// inlineView.ts: the move list written as a paragraph, with variations in brackets. From lila's
// ui/analyse/src/treeView/inlineView.ts (27ffc8b). lila shows it when you choose
// "inline notation"; the default two-column list (columnView.ts) is built on top of it.
//
// This is where engine lines stay hidden while you solve: the list only shows the moves that
// ctrl.visibleChildren returns, and commentNodes swaps "Mistake. Nf3 was best." for
// "Learn from this mistake". (While you solve a card, the list shows no comments at all.)

import type { Classes, VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderMoveNodes, renderIndex } from './components';
import { i18n } from './i18n';
import { hl, type LooseVNodes } from './snabbdom';
import type { DiscloseState } from './idbTree';
import { hasBranching, type TreeComment, type TreeNode } from './tree';

export function renderInlineView(ctrl: AnalysisCtrl): VNode {
  const renderer = new InlineView(ctrl);
  const parentNode = ctrl.tree.root;
  const parentDisclose = ctrl.idbTree.discloseOf(parentNode, true);
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
    const { isMainline, parentDisclose } = args;
    // A move made into a variation ("Convert to variation") is written as one, with the others.
    return child.forceVariation && isMainline
      ? hl('interrupt', this.lines([child, ...siblings], args))
      : [
          this.moveNode(child, args),
          parentDisclose !== 'collapsed' && [
            this.commentNodes(child),
            siblings[0] && hl('interrupt', this.lines(siblings, args)),
          ],
          this.renderNodes(this.ctrl.visibleChildren(child), this.childArgs(child, args, true)),
        ];
  }

  commentNodes(node: TreeNode, classes: Classes = {}): LooseVNodes[] {
    // Not in lila: no comments while hiding hints (AnalysisCtrl.hidingHints).
    if (!this.ctrl.showComments || this.ctrl.hidingHints() || !node.comments) return [];
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
          parentDisclose === 'expanded' && this.disclosureConnector(parentPath),
          lines.map(line => hl('line', [parentDisclose && hl('branch'), this.sidelineNodes([line], lineArgs)])),
        ]);
  }

  private sidelineNodes([child, ...siblings]: TreeNode[], args: Args): LooseVNodes {
    if (!child) return undefined;
    const childArgs = this.childArgs(child, args, false);
    const sideline = [
      this.moveNode(child, args),
      this.commentNodes(child),
      args.parenthetical && this.lines(siblings, args),
      this.ctrl.settings.disclosureMode || child.children.length < 2 || childArgs.parenthetical
        ? this.sidelineNodes(child.children, childArgs)
        : this.lines(child.children, childArgs),
      !args.parenthetical && this.lines(siblings, args),
    ];
    return this.ctrl.settings.disclosureMode && args.parentDisclose === 'expanded'
      ? hl('interrupt', sideline)
      : sideline;
  }

  private childArgs(child: TreeNode, args: Args, isMainline = false): Args {
    return {
      isMainline,
      parentPath: args.parentPath + child.id,
      parentNode: child,
      parentDisclose: this.ctrl.idbTree.discloseOf(child, false),
      parenthetical: this.parenthetical(child),
    };
  }

  // A single short variation, which is written in brackets within the line rather than below it.
  private parenthetical(node: TreeNode): boolean {
    const [, second, third] = node.children;
    return !third && !!second && !hasBranching(second, 6);
  }

  protected moveNode(
    node: TreeNode,
    { isMainline, parentPath, parentNode, parentDisclose, parenthetical }: Args,
  ): LooseVNodes {
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
      // Trim: lila's conceal and hide classes, for broadcasts.
      active: path === ctrl.path,
      current: path === currentPath,
      nongame: !currentPath && !!ctrl.gamePath && path.startsWith(ctrl.gamePath) && path !== ctrl.gamePath,
      'context-menu': path === ctrl.contextMenuPath,
      'pending-deletion': path.startsWith(ctrl.pendingDeletionPath() || ' '),
      'pending-copy': ctrl.isPendingCopy(path, isMainline),
    };
    const glyphs = [...(node.glyphs ?? [])]; // Trim: lila adds glyphs from live annotation here.
    if (ctrl.showMoveGlyphs()) {
      glyphs
        .map(g => this.glyphs[g.id - 1])
        .filter(Boolean)
        .forEach(cls => (classes[cls] = true));
    }
    return hl('move', { attrs: { p: path }, class: classes }, [
      parentDisclose && this.disclosureBtn(parentNode, parentPath),
      withIndex && renderIndex(node.ply, true),
      renderMoveNodes(node, isMainline && !this.inline, ctrl.showMoveGlyphs(), ctrl.allowedEval(node) || false, glyphs),
    ]);
  }

  // In variation hiding, the line drawn from a move's fold button down to its variations.
  protected disclosureConnector(parentPath: string): LooseVNodes {
    const callback = (vnode: VNode) => this.connectToDisclosureBtn(vnode, parentPath);
    return (
      this.ctrl.settings.disclosureMode &&
      hl(
        'div.disclosure-connector',
        { hook: { insert: callback, update: v => setTimeout(() => callback(v)) } },
        hl('div.disclosure-connector.riser'),
      )
    );
  }

  // The button that folds a move's variations away or shows them again (idbTree.ts).
  // Not in lila: none while you solve a card. The list hides the analysis's lines and comments then
  // (AnalysisCtrl.hidingHints), so the buttons would have nothing to fold.
  private disclosureBtn(node: TreeNode, path: string): LooseVNodes {
    return (
      this.ctrl.settings.disclosureMode &&
      !this.ctrl.hidingHints() &&
      hl('a.disclosure', {
        class: { expanded: !node.collapsed },
        attrs: { 'data-path': path },
        on: { click: () => this.ctrl.idbTree.setCollapsed(path, !node.collapsed) },
      })
    );
  }

  // Trim: lila skips this on Safari older than 16.
  private connectToDisclosureBtn(v: VNode, path: string): void {
    const [el, btn] = [v.elm as HTMLElement, this.findDisclosureBtn(v.elm, path)];
    if (!el || !btn) return;

    const btnRect = btn.getBoundingClientRect();
    const anchorRect = el.closest('.anchor')!.getBoundingClientRect();
    const isFirstOnRow = btnRect.left < anchorRect.left + 8;
    const distanceMinusRiser = anchorRect.top - btnRect.bottom + btnRect.height / 2;
    const baseHeight = Math.max(0, distanceMinusRiser - (isFirstOnRow ? 0 : 12));
    const btnCenter = btnRect.width / 2;
    const width = isFirstOnRow
      ? 3
      : document.documentElement.dir === 'rtl'
        ? anchorRect.right - btnRect.left - btnCenter
        : btnRect.right - anchorRect.left - btnCenter;

    el.style.width = `${width}px`;
    el.style.height = `${baseHeight}px`;
    el.style.top = `-${baseHeight}px`;
    (el.firstElementChild as HTMLElement).style.display = isFirstOnRow ? 'none' : 'block';
  }

  private findDisclosureBtn(el: Node | null | undefined, path: string): HTMLElement | undefined {
    while (el && (el.nodeName !== 'A' || (el as HTMLElement).dataset.path !== path)) {
      if (!el.previousSibling) el = el.parentNode;
      else {
        el = el.previousSibling;
        while (el.lastChild) el = el.lastChild;
      }
    }
    return el as HTMLElement;
  }
}
