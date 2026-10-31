// gameDownload.test.ts: checks downloading your games from Lichess, with a stand-in for Lichess.
import { afterEach, expect, test, vi } from 'vitest';

import { downloadGames, downloadNewGames, sinceNewest } from './gameDownload';
import type { LichessGameJson } from './tree';

afterEach(() => vi.unstubAllGlobals());

// Lichess's answer: `status`, and for 200, the text in pieces, as a stream would bring it.
const answer = (status: number, pieces: string[] = []) => {
  const bytes = new TextEncoder().encode(pieces.join(''));
  const cuts = pieces.reduce<number[]>((at, p) => [...at, (at.at(-1) ?? 0) + new TextEncoder().encode(p).length], []);
  // Cut the bytes where the text pieces end, but one byte early, to split a letter in two.
  const chunks = cuts.map((end, i) => bytes.slice(i ? cuts[i - 1] - 1 : 0, i === cuts.length - 1 ? end : end - 1));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach(c => controller.enqueue(c));
      controller.close();
    },
  });
  return new Response(status === 200 ? body : '{}', { status });
};
const asked: { url: string; accept: string }[] = [];
const lichess = (...answers: Response[]) => {
  asked.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      asked.push({ url, accept: (init.headers as Record<string, string>).Accept });
      return answers.shift()!;
    }),
  );
};

test('one request for your games of the given kinds, with their analysis, read as they arrive', async () => {
  // The first piece ends in "ë", two bytes, which the cut splits between pieces; the second ends a
  // line and starts another.
  const lines = ['{"id":"a1","players":{"white":{"user":{"name":"Zoë', '"}}}}\n{"id":"b2"}\n{"id":"c', '3"}\n'];
  lichess(answer(200, lines));
  const counts: number[] = [];
  const games = await downloadGames('Muggles Man', ['blitz', 'rapid'], undefined, n => counts.push(n));
  expect(games.map(g => g.id)).toEqual(['a1', 'b2', 'c3']);
  expect(games[0].players?.white.user?.name).toBe('Zoë'); // a letter split between two pieces
  expect(counts).toEqual([1, 2, 3]);
  expect(asked).toHaveLength(1);
  const url = new URL(asked[0].url);
  expect(url.origin + url.pathname).toBe('https://lichess.org/api/games/user/Muggles%20Man');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    perfType: 'blitz,rapid',
    evals: 'true',
    clocks: 'true',
    accuracy: 'true',
    opening: 'true',
    division: 'true',
  });
  expect(asked[0].accept).toBe('application/x-ndjson');
});

test('an update asks only for the games since the newest you have', async () => {
  const have = [{ createdAt: 1000 }, { createdAt: 3000 }, { createdAt: 2000 }] as LichessGameJson[];
  expect(sinceNewest(have)).toBe(3001);
  expect(sinceNewest([])).toBeUndefined();
  lichess(answer(200, []));
  expect(await downloadGames('x', ['blitz'], 3001)).toEqual([]);
  expect(new URL(asked[0].url).searchParams.get('since')).toBe('3001');
});

test('"Too many requests": a minute later it tries once more, then gives up', async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => void waits.push(ms);
  lichess(answer(429), answer(200, ['{"id":"a1"}\n']));
  expect((await downloadGames('x', ['blitz'], undefined, undefined, wait)).map(g => g.id)).toEqual(['a1']);
  expect(waits).toEqual([60_000]);
  lichess(answer(429), answer(429));
  await expect(downloadGames('x', ['blitz'], undefined, undefined, wait)).rejects.toThrow(
    'Lichess says too many requests. Try again in a few minutes.',
  );
  expect(asked).toHaveLength(2); // and no more
});

test('a name Lichess finds no games for, or another error, says so', async () => {
  lichess(answer(404));
  await expect(downloadGames('nobody', ['blitz'])).rejects.toThrow("Lichess didn't find games for nobody. Is the name right?");
  lichess(answer(500));
  await expect(downloadGames('x', ['blitz'])).rejects.toThrow("Couldn't download your games from Lichess (500).");
});

test('"Update deck": the games since your newest of each kind; all of a kind you have none of yet', async () => {
  const saved = [
    { id: 'b1', speed: 'blitz', createdAt: 5000 },
    { id: 'r1', speed: 'rapid', createdAt: 3000 },
    { id: 'u1', speed: 'bullet', createdAt: 9000 }, // a kind you no longer choose
  ] as LichessGameJson[];
  lichess(answer(200, ['{"id":"b2"}\n']), answer(200, ['{"id":"c1"}\n{"id":"c2"}\n']));
  const counts: number[] = [];
  const games = await downloadNewGames('x', ['blitz', 'rapid', 'classical'], saved, n => counts.push(n));
  expect(games.map(g => g.id)).toEqual(['b2', 'c1', 'c2']);
  expect(counts).toEqual([1, 2, 3]);
  const [recent, all] = asked.map(a => Object.fromEntries(new URL(a.url).searchParams));
  expect([recent.perfType, recent.since]).toEqual(['blitz,rapid', '3001']); // since rapid's newest, the older
  expect([all.perfType, all.since]).toEqual(['classical', undefined]);
  // With nothing saved, everything, in one request.
  lichess(answer(200, ['{"id":"a"}\n']));
  await downloadNewGames('x', ['blitz', 'rapid'], []);
  expect(asked).toHaveLength(1);
  expect(Object.fromEntries(new URL(asked[0].url).searchParams)).not.toHaveProperty('since');
});
