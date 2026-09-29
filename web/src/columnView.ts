// columnView.ts: the default move list, with White's and Black's moves in two columns and
// variations and comments breaking in between. From lila's ui/analyse/src/treeView/columnView.ts
// (master, commit 27ffc8b). It reuses InlineView for variations, comments, and single moves.
// Every change from lila's version is marked with a comment starting "Trim:".

import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { renderIndex } from './components';
import { discloseOf, InlineView, type Args } from './inlineView';
import { hl, type LooseVNodes } from './snabbdom';
import type { TreeNode } from './tree';

// Trim: lila also takes `concealOf`, which hides moves a broadcast hasn't revealed yet.
export function renderColumnView(ctrl: AnalysisCtrl): VNode {
  const renderer = new ColumnView(ctrl);
  const node = ctrl.tree.root;
  const commentTags = renderer.commentNodes(node);
  const blackStarts = (node.ply & 1) === 1;
  // Trim: lila hides the list until IndexedDB has loaded.
  return hl('div.tview2.tview2-column', [
    commentTags.length > 0 && hl('interrupt', commentTags),
    blackStarts && [renderIndex(node.ply, false), hl('move.empty', '...')],
    renderer.renderNodes(ctrl.visibleChildren(node), {
      parentPath: '',
      parentDisclose: discloseOf(ctrl, node, true),
      parentNode: node,
      isMainline: true,
    }),
  ]);
}

class ColumnView extends InlineView {
  override readonly inline: boolean = false;

  override renderNodes([child, ...siblings]: TreeNode[], opts: Args): LooseVNodes {
    if (!child) return undefined;
    const { parentPath, parentDisclose } = opts;
    const childPath = parentPath + child.id;
    const emptyMove = () => hl('move.empty', '...');
    const isWhite = child.ply % 2 === 1;
    const comments = this.commentNodes(child);
    const interruptData = { class: { anchor: parentDisclose === 'expanded' } };
    // Trim: lila first checks child.forceVariation, a study feature.
    return [
      isWhite && renderIndex(child.ply, false),
      this.moveNode(child, opts),
      // A variation or comment after White's move breaks the row: "..." fills Black's column before
      // it, and the move number repeats with "..." after it.
      parentDisclose !== 'collapsed' &&
        (siblings.length > 0 || comments.length > 0) && [
          isWhite && emptyMove(),
          hl('interrupt', interruptData, [
            comments,
            siblings.length > 0 && this.lines(siblings, opts), // Trim: lila draws a line to the fold button otherwise.
          ]),
          isWhite && child.children.length > 0 && [renderIndex(child.ply, false), emptyMove()],
        ],
      this.renderNodes(this.ctrl.visibleChildren(child), {
        parentPath: childPath,
        parentNode: child,
        parentDisclose: discloseOf(this.ctrl, child, true),
        isMainline: true,
      }),
    ];
  }
}
