// topBar.ts: lila's ui/site/src/topBar.ts (27ffc8b), its "stick top bar" part. lila's CSS keeps the
// header at the top of the window; this gives it a background (`scrolled`) once the page has
// scrolled, and slides it away (`hide`) while you scroll down.
// Trim: not the rest, which runs the header's menu, notifications, search, and account buttons.

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
  // Trim: not lila's double-tap on the board, which lines the board up with the window's top.
}
