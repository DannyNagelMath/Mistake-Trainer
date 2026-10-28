// topBar.ts: the site header as the page scrolls. From lila's ui/site/src/topBar.ts (master,
// commit 27ffc8b), its "stick top bar" part. Every change from lila's version is marked with a
// comment starting "Trim:".
// Trim: the rest of lila's topBar.ts runs the header's menu, notifications, search, and account
// buttons, which our header doesn't have.
//
// lila's stylesheet keeps the header at the top of the window while the page scrolls (on screens at
// least 600 pixels high). This marks it `scrolled` once the page has scrolled, which gives it a
// background, so the page doesn't show through it; and `hide` while you scroll down, which slides it
// out of the way until you scroll back up.

export default function (): void {
  const top = document.getElementById('top')!;

  // stick top bar
  let lastY = window.scrollY;
  if (lastY > 0) top.classList.add('scrolled');

  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      top.classList.toggle('scrolled', y > 0);
      if (y > lastY + 10) top.classList.add('hide');
      // Trim: lila's clamp (lib/algo.ts), written out: back up 20 pixels, within the page.
      else if (y <= Math.max(0, Math.min(lastY - 20, document.body.scrollHeight - window.innerHeight)))
        top.classList.remove('hide');
      else return;

      lastY = Math.max(0, y);
    },
    { passive: true },
  );
  // Trim: lila also lets you double-tap the board on a touchscreen to line its top up with the
  // window's.
}
