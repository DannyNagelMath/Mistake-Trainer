// backup.test.ts: checks Export's file (collectBackup, from the dev server's files, which a stand-in
// answers for), what Import accepts (readBackup), the sample deck, and Start over.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import sample from '../public/sample.json';
import { collectBackup, exportFileName, readBackup, startOver, trySample, type Backup } from './backup';
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

test("the exported file is named with the date where you are, even late in the evening", () => {
  expect(exportFileName(new Date(2026, 9, 30, 23, 59))).toBe('mistake-trainer-2026-10-30.json'); // 11:59 PM, your time
  expect(exportFileName(new Date(2026, 0, 5, 0, 1))).toBe('mistake-trainer-2026-01-05.json');
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

// What the page sent the dev server to replace everything with, and whether it then loaded again.
function replacing(answers: Record<string, unknown>) {
  const sent: unknown[] = [];
  const reload = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        sent.push({ url, body: JSON.parse(init.body as string) });
        return new Response(null, { status: 204 });
      }
      return Response.json(answers[url]);
    }),
  );
  vi.stubGlobal('location', { pathname: '/', reload });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('confirm', () => true);
  vi.stubGlobal('alert', (message: string) => sent.push({ alert: message }));
  return { sent, reload };
}

test("the sample deck is an export with a deck, and nothing of its owner's but the games: no reviews, default settings", () => {
  const backup = readBackup(JSON.stringify(sample));
  expect(backup.deck!.cards.length).toBeGreaterThan(0);
  expect(backup.reviews).toEqual({ cards: {}, log: [] });
  expect(backup.settings).toEqual(defaultSettings);
});

test('"Try a sample deck" replaces everything with it, then loads the page again', async () => {
  const { sent, reload } = replacing({ '/sample.json': sample });
  await trySample();
  const { reviews, settings, analyses, games, masters, deck } = sample;
  expect(sent).toEqual([{ url: '/api/import', body: { reviews, settings, analyses, games, masters, deck } }]);
  expect(reload).toHaveBeenCalled();
});

test('"Start over" empties everything but your settings and the masters database\'s answers, then loads the page again', async () => {
  const { sent, reload } = replacing(kept);
  await startOver();
  expect(sent).toEqual([
    {
      url: '/api/import',
      body: {
        reviews: { cards: {}, log: [] },
        settings: { ...defaultSettings, minGapDays: 5 },
        analyses: {},
        games: [],
        masters: kept['/api/masters'],
        deck: null,
      },
    },
  ]);
  expect(reload).toHaveBeenCalled();
});

test('"Start over" does nothing unless you say yes', async () => {
  const { sent, reload } = replacing(kept);
  vi.stubGlobal('confirm', () => false);
  await startOver();
  expect(sent).toEqual([]);
  expect(reload).not.toHaveBeenCalled();
});
