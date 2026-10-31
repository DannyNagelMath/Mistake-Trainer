// snabbdom.ts: lila's helpers for writing views, copied from ui/lib/src/view/snabbdom.ts
// (master, commit 27ffc8b). Only what we use.

import { h, type Hooks, type VNode, type VNodeChildElement, type VNodeData } from 'snabbdom';

export function onInsert<A extends HTMLElement>(f: (element: A) => void): Hooks {
  return {
    insert: vnode => f(vnode.elm as A),
  };
}

// Listens for an event on the element once it's on the page, and redraws afterwards if asked to.
// Most controller functions don't redraw themselves, so views pass ctrl.redraw here.
export function bind<K extends keyof GlobalEventHandlersEventMap>(
  eventName: K,
  f: (ev: GlobalEventHandlersEventMap[K]) => any,
  redraw?: () => void,
  passive = true,
): Hooks {
  return onInsert(el =>
    el.addEventListener(
      eventName,
      e => {
        const res = f(e);
        if (res === false && !passive) e.preventDefault();
        redraw?.();
        return res;
      },
      { passive },
    ),
  );
}

// Like bind, but f can stop the browser's default action (e.g. scrolling the page) by calling
// e.preventDefault() or returning false.
export const bindNonPassive = <K extends keyof GlobalEventHandlersEventMap>(
  eventName: K,
  f: (ev: GlobalEventHandlersEventMap[K]) => any,
  redraw?: () => void,
): Hooks => bind(eventName, f, redraw, false);

export type LooseVNode = VNodeChildElement | boolean;
export type LooseVNodes = LooseVNode | LooseVNodes[];

// '' may be falsy but it's a valid VNode
// 0 may be falsy but it's a valid VNode
const kidFilter = (x: VNodeData | LooseVNodes): boolean => (x && x !== true) || x === '' || x === 0;

const filterKids = (children: LooseVNodes): VNodeChildElement[] => {
  const flatKids: LooseVNode[] = [];
  flattenKids(children, flatKids);
  return flatKids.filter(kidFilter) as VNodeChildElement[];
};

// Like snabbdom's h, but it drops false, true, undefined, and null children and flattens nested
// arrays, which allows
//   hl('div', isDivEmpty || [ 'foo', fooHasBar && [ 'has', 'bar' ])
export function hl(sel: string, dataOrKids?: VNodeData | LooseVNodes, kids?: LooseVNodes): VNode {
  if (kids) return h(sel, dataOrKids as VNodeData, filterKids(kids));
  if (!kidFilter(dataOrKids)) return h(sel);
  if (Array.isArray(dataOrKids) || (typeof dataOrKids === 'object' && 'sel' in dataOrKids!))
    return h(sel, filterKids(dataOrKids as LooseVNodes));
  else return h(sel, dataOrKids as VNodeData);
}

const flattenKids = (maybeArray: LooseVNodes, out: LooseVNode[]) => {
  if (Array.isArray(maybeArray)) for (const el of maybeArray) flattenKids(el, out);
  else out.push(maybeArray);
};
