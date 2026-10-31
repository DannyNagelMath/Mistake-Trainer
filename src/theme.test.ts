// theme.test.ts: checks the background (theme.ts): your choice, remembered, and System following
// your computer's, with stand-ins for the browser.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { background, setBackground } from './theme';

let stored: Record<string, string>;
let systemLight: boolean;
beforeEach(() => {
  stored = {};
  systemLight = false;
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => void (stored[k] = v) });
  vi.stubGlobal('matchMedia', () => ({ matches: systemLight }));
  vi.stubGlobal('document', { documentElement: { className: 'dark' } });
});
afterEach(() => vi.unstubAllGlobals());

test('System by default, as on Lichess; your choice is remembered, and the page takes it at once', () => {
  expect(background()).toBe('system');
  setBackground('light');
  expect(background()).toBe('light');
  expect(document.documentElement.className).toBe('light');
  setBackground('dark');
  expect(document.documentElement.className).toBe('dark');
});

test("System is light or dark as your computer's setting is", () => {
  systemLight = true;
  setBackground('system');
  expect(document.documentElement.className).toBe('light');
  systemLight = false;
  setBackground('system');
  expect(document.documentElement.className).toBe('dark');
});

test("anything else stored counts as System; without storage, it's System too", () => {
  stored['mistakeTrainer.background'] = 'transparent';
  expect(background()).toBe('system');
  vi.stubGlobal('localStorage', undefined);
  expect(background()).toBe('system');
});
