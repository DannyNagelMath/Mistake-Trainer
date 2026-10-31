// theme.ts: Not in lila, whose account menu has it: the page's background, Light, Dark, or System
// (your computer's), which this browser remembers. lila's stylesheets draw the light theme for
// html.light and the dark one for html.dark. index.html applies it before the page draws, the same
// way as `apply` below; the board's Settings dialog changes it (analysisSettingsView.ts).

export type Background = 'light' | 'dark' | 'system';
export const backgrounds: Background[] = ['light', 'dark', 'system'];

const KEY = 'mistakeTrainer.background'; // as in index.html
const SYSTEM_LIGHT = '(prefers-color-scheme: light)';

export function background(): Background {
  try {
    const chosen = localStorage.getItem(KEY) as Background;
    return backgrounds.includes(chosen) ? chosen : 'system'; // lila's default
  } catch {
    return 'system';
  }
}

function apply(): void {
  const chosen = background();
  const light = chosen === 'light' || (chosen === 'system' && matchMedia(SYSTEM_LIGHT).matches);
  document.documentElement.className = light ? 'light' : 'dark';
}

export function setBackground(chosen: Background): void {
  try {
    localStorage.setItem(KEY, chosen);
  } catch {}
  apply();
}

// With System, the page follows your computer when its setting changes. main.ts calls it.
export const followSystem = (): void => matchMedia(SYSTEM_LIGHT).addEventListener('change', apply);
