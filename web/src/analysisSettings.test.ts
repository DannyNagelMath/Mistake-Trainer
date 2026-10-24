// analysisSettings.test.ts: checks the analysis board's settings (analysisSettings.ts), which the
// browser remembers, and the annotations they can put on the board (glyphs.ts).
import { afterEach, expect, test, vi } from 'vitest';

import { AnalysisSettingsCtrl } from './analysisSettings';
import { annotationShapes } from './glyphs';
import type { TreeNode } from './tree';

// A stand-in for the browser's localStorage.
function fakeStorage(stored: Record<string, string> = {}) {
  const storage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => (stored[key] = value),
    removeItem: (key: string) => delete stored[key],
  };
  vi.stubGlobal('localStorage', storage);
  return stored;
}
afterEach(() => vi.unstubAllGlobals());

test("lila's defaults, until you change one; the browser remembers the change", () => {
  const stored = fakeStorage();
  const redraw = vi.fn();
  const settings = new AnalysisSettingsCtrl(redraw);
  expect(Object.fromEntries(settings.keys().map(k => [k, settings[k]]))).toEqual({
    showGauge: true,
    inline: false,
    showStaticAnalysis: true,
    showBestMoveArrows: true,
    showMoveAnnotationsOnBoard: true,
  });
  settings.set('inline', true);
  expect(redraw).toHaveBeenCalledOnce();
  expect(JSON.parse(stored['analyse.settings'])).toMatchObject({ inline: true, showStaticAnalysis: true });
  expect(new AnalysisSettingsCtrl().inline).toBe(true); // the next time the page loads
  settings.set('inline', true);
  expect(redraw).toHaveBeenCalledOnce(); // no change, no redraw
});

test('unreadable stored settings are thrown away, and with no storage at all, the defaults stand', () => {
  const stored = fakeStorage({ 'analyse.settings': '{not json' });
  expect(new AnalysisSettingsCtrl().showStaticAnalysis).toBe(true);
  expect(stored['analyse.settings']).toBeUndefined();
  vi.stubGlobal('localStorage', undefined);
  const settings = new AnalysisSettingsCtrl();
  settings.set('showStaticAnalysis', false); // can't be saved, but works until the page reloads
  expect(settings.showStaticAnalysis).toBe(false);
});

test("a move's annotations go on the square it went to, as lila draws them", () => {
  const node = (san: string, uci: string, symbols: string[]): TreeNode => ({
    id: '',
    ply: 1,
    fen: '',
    san,
    uci,
    glyphs: symbols.map((symbol, id) => ({ id, symbol, name: symbol })),
    children: [],
  });
  const [blunder] = annotationShapes(node('Qh4', 'h6h4', ['??']));
  expect(blunder.orig).toBe('h4');
  expect(blunder.customSvg?.html).toBeTruthy(); // chessground's picture of "??"...
  expect(blunder.label).toBeUndefined(); // ...rather than the plain text lila falls back on
  expect(annotationShapes(node('O-O', 'e1h1', ['?!']))[0].orig).toBe('g1'); // castling: where the king goes
  expect(annotationShapes(node('O-O-O', 'e8a8', ['?']))[0].orig).toBe('c8');
  expect(annotationShapes({ ...node('e4', 'e2e4', []), glyphs: undefined })).toEqual([]);
});
