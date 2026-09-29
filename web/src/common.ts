// common.ts: small helpers from lila's ui/lib (master, commit 27ffc8b): toggle, repeater, and
// blurIfPrimaryClick from src/common.ts, isTouchDevice and isMac from src/device.ts,
// addPointerListeners from src/pointer.ts, and stepwiseScroll from src/view/stepwiseScroll.ts.
// Every change from lila's version is marked with a comment starting "Trim:".

// ---------- common.ts ----------

// A stored true/false: read it with t(), set it with t(value), or flip it with t.toggle().
// Trim: lila's also runs an `effect` function whenever the value is set.
export interface Toggle {
  (): boolean;
  (v: boolean): boolean;
  toggle(): void;
}

export const toggle = (initialValue: boolean): Toggle => {
  let value = initialValue;
  const t = ((v?: boolean) => {
    if (v !== undefined) value = v;
    return value;
  }) as Toggle;
  t.toggle = () => t(!t());
  return t;
};

// Calls f now, then again and again until the pointer is released: after 500ms, then a little
// faster each time, down to every 100ms. Used when you hold down the prev or next button.
export function repeater(f: () => void, additionalStopCond?: () => boolean): void {
  let timeout: number | undefined = undefined;
  const delay = (function* () {
    yield 500;
    for (let d = 350; ; ) yield Math.max(100, (d *= 14 / 15));
  })();
  const repeat = () => {
    f();
    // Trim: lila writes plain setTimeout. The scripts' typecheck includes Node's types, where
    // setTimeout returns an object rather than a number; window.setTimeout is the browser's.
    timeout = window.setTimeout(repeat, delay.next().value);
    if (additionalStopCond?.()) clearTimeout(timeout);
  };
  repeat();
  document.addEventListener('pointerup', () => clearTimeout(timeout), { once: true });
}

// After a mouse click on a button, takes the keyboard focus off it, so that the arrow keys
// navigate moves rather than moving between buttons.
export function blurIfPrimaryClick(e: Event): void {
  if (!(e instanceof MouseEvent)) return;
  const target = document.activeElement;
  if (target instanceof HTMLElement && e.button === 0 && (e.clientX || e.clientY))
    requestAnimationFrame(() => target.blur());
}

// ---------- device.ts ----------

// Trim: lila works these out once and remembers them (memoize).
export const isTouchDevice = (): boolean => !window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export const isMac = (): boolean => navigator.userAgent.toLowerCase().includes('macintosh') && !('ontouchstart' in window);

// ---------- pointer.ts ----------

// PointerEvent listeners to allow vertical scrolling on touch devices

export type PointerListeners = {
  click?: (e: PointerEvent) => void;
  hold?: 'click' | ((e: PointerEvent) => void);
  holdDuration?: number;
};

// Calls `click` for a quick press, and `hold` when the pointer stays down for holdDuration ms.
// Moving more than 12 pixels up or down cancels both, so you can scroll a page by dragging on it.
export function addPointerListeners(el: HTMLElement, listeners: PointerListeners): void {
  const { click, hold } = listeners;
  const g = { timer: 0, y: 0 };
  const holdDuration = listeners.holdDuration ?? 500;

  const reset = (e: PointerEvent) => {
    clearTimeout(g.timer);
    el.releasePointerCapture(e.pointerId);
    el.removeEventListener('pointermove', pointermove);
    g.y = g.timer = 0;
  };

  const pointerdown = (e: PointerEvent) => {
    g.y = e.clientY;
    g.timer = window.setTimeout(() => {
      if (!hold) return;
      if (hold === 'click') click?.(e);
      else hold(e);
      reset(e);
    }, holdDuration);
    el.addEventListener('pointermove', pointermove, { passive: false });
  };

  const pointermove = (e: PointerEvent) => {
    const dy = e.clientY - g.y;
    if (Math.abs(dy) > 12) return reset(e); // page scroll
  };

  const pointerup = (e: PointerEvent) => {
    if (g.timer && click) click(e);
    reset(e);
    e.preventDefault();
  };

  el.addEventListener('pointerup', pointerup, { passive: false });
  el.addEventListener('pointerdown', pointerdown, { passive: true });
  el.addEventListener('pointercancel', reset, { passive: true });

  if (isTouchDevice() && hold) {
    el.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });
  }
}

// ---------- view/stepwiseScroll.ts ----------

// Turns scroll-wheel events into steps: one step per wheel click, and on a Mac touchpad one step
// per 10 pixels of scrolling. shouldSkip lets the page scroll normally instead.
export function stepwiseScroll(
  scrollAction: (e: WheelEvent) => void,
  shouldSkip: (e: WheelEvent) => boolean,
  ifSkipShouldStillPreventDefault?: boolean,
): (e: WheelEvent) => void {
  let accumulatedDeltaPixelMode = 0;
  return (e: WheelEvent) => {
    if (e.ctrlKey) return; // if touchpad zooming, e.ctrlKey is true
    if (shouldSkip(e)) {
      if (ifSkipShouldStillPreventDefault) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (e.deltaMode === 0) {
      accumulatedDeltaPixelMode += e.deltaY;
      if (isMac() && Math.abs(accumulatedDeltaPixelMode) < 10) return;
    }
    accumulatedDeltaPixelMode = 0;
    scrollAction(e);
  };
}
