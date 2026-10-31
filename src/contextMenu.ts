// contextMenu.ts: the menu that opens when you right-click a move in the move list (or double-tap
// it, or press and hold it, on a touch screen); treeView.ts opens it. From lila's
// ui/analyse/src/treeView/contextMenu.ts (27ffc8b), with nodeFullName and patch
// from ui/analyse/src/view/util.ts.
// Trim: lila uses cash ($), a small jQuery, to find and change the menu's element.

import { init, attributesModule, classModule, eventListenersModule, propsModule, type VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import { isTouchDevice } from './common';
import { plyToTurn } from './components';
import { i18n } from './i18n';
import { licon } from './licon';
import { renderNodesPgn } from './pgnExport';
import { hl, onInsert } from './snabbdom';
import type { TreeNode } from './tree';

// The menu is drawn into an element of its own at the end of the page, outside the page's view,
// once each time it opens.
const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);

export function renderContextMenu(e: MouseEvent, ctrl: AnalysisCtrl, path: string): void {
  let pos = getPosition(e);
  if (pos === null) {
    if (ctrl.contextMenuPath) return;
    pos = { x: 0, y: 0 };
  }

  const el = document.getElementById(elementId) || document.body.appendChild(menuElement());
  ctrl.contextMenuPath = path;
  function close(e: MouseEvent) {
    if (e.button === 2) return; // right click
    ctrl.contextMenuPath = undefined;
    document.removeEventListener('click', close, false);
    document.getElementById(elementId)?.classList.remove('visible');
    ctrl.redraw();
  }
  document.addEventListener('click', close, false);
  el.innerHTML = '';
  patch(el, view(ctrl, path, pos));
}

interface Coords {
  x: number;
  y: number;
}

interface PageOrClientPos {
  pageX?: number;
  pageY?: number;
  clientX?: number;
  clientY?: number;
}

const elementId = 'analyse-cm';

function menuElement(): HTMLElement {
  const el = document.createElement('div');
  el.id = elementId;
  return el;
}

function getPosition(e: MouseEvent | TouchEvent): Coords | null {
  let pos = e as PageOrClientPos;
  if ('touches' in e && e.touches.length > 0) pos = e.touches[0];
  if (pos.pageX || pos.pageY) return { x: pos.pageX!, y: pos.pageY! };
  else if (pos.clientX || pos.clientY)
    return {
      x: pos.clientX! + document.body.scrollLeft + document.documentElement.scrollLeft,
      y: pos.clientY! + document.body.scrollTop + document.documentElement.scrollTop,
    };
  else return null;
}

// Puts the menu where you clicked, or if it wouldn't fit in the window there, against the window's
// right or bottom edge.
// Fix: coords are measured from the top left of the page, and lila compares them with the window's
// size as if the page weren't scrolled. On a page scrolled down, such as a phone's, with the moves
// below the board, the menu then opened higher than where you clicked, or above the window, out of
// sight. Here they're measured from the window's top left (x, y) to see if the menu fits.
function positionMenu(menu: HTMLElement, coords: Coords): void {
  const menuWidth = menu.offsetWidth + 4,
    menuHeight = menu.offsetHeight + 4,
    windowWidth = window.innerWidth,
    windowHeight = window.innerHeight,
    x = coords.x - window.scrollX,
    y = coords.y - window.scrollY;

  menu.style.left = windowWidth - x < menuWidth ? windowWidth - menuWidth + window.scrollX + 'px' : coords.x + 'px';

  menu.style.top = windowHeight - y < menuHeight ? windowHeight - menuHeight + window.scrollY + 'px' : coords.y + 'px';
}

// One of the menu's items. onHover and onLeave are for when the pointer goes over it and leaves it.
function action(icon: string, text: string, onClick: () => void, onHover?: () => void, onLeave?: () => void): VNode {
  return hl(
    'a',
    {
      attrs: { 'data-icon': icon },
      hook: onInsert(elm => {
        elm.addEventListener('click', onClick);
        if (onHover && !isTouchDevice())
          elm.addEventListener('mouseover', () => {
            onHover();
            // If there is a special action for hover, make the menu transparent so that effects
            // on the move list can be fully seen:
            document.getElementById(elementId)?.classList.add('transparent');
          });
        if (onLeave)
          elm.addEventListener('mouseout', () => {
            onLeave();
            document.getElementById(elementId)?.classList.remove('transparent');
          });
      }),
    },
    text,
  );
}

// Exported for the tests; lila's isn't.
export function view(ctrl: AnalysisCtrl, path: string, coords: Coords): VNode {
  const { tree, idbTree } = ctrl;
  // Trim: lila offers "Prune to main line" in a correspondence game that's still being played.
  const node = tree.nodeAtPath(path),
    onMainline = tree.pathIsMainline(path) && !tree.pathIsForcedVariation(path);
  // "Promote variation" isn't offered where it would do what "Make main line" does: in the first
  // variation from the main line, along its own main line.
  let canPromote = !onMainline;
  for (let iter = tree.lastMainlineNode(path).children[1]; canPromote && iter; iter = iter.children[0]) {
    if (iter === node) canPromote = false;
  }

  return hl(
    'div#' + elementId + '.visible',
    {
      hook: {
        ...onInsert(elm => {
          elm.addEventListener('contextmenu', e => (e.preventDefault(), false));
          positionMenu(elm, coords);
        }),
        postpatch: (_, vnode) => positionMenu(vnode.elm as HTMLElement, coords),
      },
    },
    [
      hl('p.title', nodeFullName(node)),

      idbTree.someCollapsedOf(false) && // with variation hiding enabled, collapse/expand all are most common
        action(licon.MinusButton, 'Collapse all', () => idbTree.setCollapsedFrom('', true)),

      idbTree.someCollapsedOf(true) &&
        action(licon.PlusButton, 'Expand all', () => idbTree.setCollapsedFrom('', false)),

      canPromote && action(licon.UpTriangle, i18n.site.promoteVariation, () => ctrl.promote(path, false)),
      !onMainline && action(licon.Checkmark, i18n.site.makeMainLine, () => ctrl.promote(path, true)),
      // Trim: lila adds its studies' items here.

      path &&
        onMainline &&
        action(licon.InternalArrow, i18n.site.forceVariation, () => ctrl.forceVariation(path, true)),

      action(
        licon.Clipboard,
        onMainline ? i18n.site.copyMainLinePgn : i18n.site.copyVariationPgn,
        () => navigator.clipboard.writeText(renderNodesPgn(ctrl.game, ctrl.tree.getNodeList(path), !onMainline)),
        () => ctrl.pendingCopy({ eventPath: path, withVariations: !onMainline }),
        () => ctrl.pendingCopy(null),
      ),

      path &&
        action(
          licon.Trash,
          i18n.site.deleteFromHere,
          () => ctrl.deleteNode(path),
          () => ctrl.pendingDeletionPath(path),
          () => ctrl.pendingDeletionPath(null),
        ),
    ],
  );
}

// The menu's title: the move, e.g. "12... Nxe4". Trim: lila removes the P from crazyhouse pawn
// drops (fixCrazySan).
const nodeFullName = (node: TreeNode): string =>
  node.san ? plyToTurn(node.ply) + (node.ply % 2 === 1 ? '.' : '...') + ' ' + node.san : 'Initial position';
