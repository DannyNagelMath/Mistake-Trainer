// backup.test.ts: checks Export's file (collectBackup, from the dev server's files, which a stand-in
// answers for), and what Import accepts (readBackup).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { collectBackup, readBackup, type Backup } from './backup';
import { defaultSettings } from './settings';

const kept: Record<string, unknown> = {
  '/api/reviews': { cards: { 'a/1': { due: '2026-11-01T00:00:00.000Z' } }, log: [{ cardId: 'a/1', result: 'win' }] },
  '/api/settings': { minGapDays: 5 },
  '/api/analysis': { b: { analysis: [], engine: 'Stockfish 19', nodes: 1_000_000, at: '2026-10-30T00:00:00.000Z' } },
  '/api/games': [{ id: 'a' }, { id: 'b' }],
  '/api/masters': { 'fen-1': [] },
  '/api/deck': null, // not built yet
};
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => Response.json(kept[url])),
  );
});
afterEach(() => vi.unstubAllGlobals());

test('Export collects everything: reviews, settings, analyses, games, masters, and deck, with what made it and when', async () => {
  const backup = await collectBackup();
  expect(backup).toMatchObject({
    app: 'Mistake Trainer',
    version: 1,
    reviews: kept['/api/reviews'],
    settings: { ...defaultSettings, minGapDays: 5 },
    analyses: kept['/api/analysis'],
    games: kept['/api/games'],
    masters: kept['/api/masters'],
    deck: null,
  });
  expect(Date.now() - new Date(backup.exportedAt).getTime()).toBeLessThan(5000);
});

test("Import takes an exported file, and nothing else", async () => {
  const backup = await collectBackup();
  expect(readBackup(JSON.stringify(backup))).toEqual(backup);
  const not = (text: string) => expect(() => readBackup(text)).toThrow("That file isn't one that Mistake Trainer exported.");
  not('not JSON at all');
  not(JSON.stringify({ ...backup, app: 'Something else' }));
  not(JSON.stringify({ ...backup, version: 2 }));
  const { games: _, ...noGames } = backup;
  not(JSON.stringify(noGames));
  not(JSON.stringify({ ...backup, reviews: { cards: {} } } as unknown as Backup));
});
