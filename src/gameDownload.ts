// gameDownload.ts: Not in lila. Downloads your games from Lichess's API, in the browser, with
// their computer analysis when Lichess has made one. No token is needed, as they're public games;
// with the one from signing in (lichessAuth.ts), Lichess sends them faster: 30 games a second
// rather than 20, and 60 for your own (its API documentation, "Export games of a user").
// Being gentle with Lichess's servers, as its API documentation asks (https://lichess.org/api,
// "Rate limiting"): one request at a time, streamed; on 429 (too many requests), wait a full
// minute and try once more; and for an update, only the games since the newest you have.

import type { LichessGameJson } from './tree';

// Lichess's names for the kinds of games, by time control, in Lichess's order.
export const speeds = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'] as const;
export type Speed = (typeof speeds)[number];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// The `since` for an update: just after the newest game you have started (Lichess counts a game
// from its start, in milliseconds), or undefined, for all your games.
export function sinceNewest(games: LichessGameJson[]): number | undefined {
  const newest = games.reduce((max, g) => Math.max(max, g.createdAt ?? 0), 0);
  return newest ? newest + 1 : undefined;
}

export interface DownloadOptions {
  since?: number; // only the games from then on
  token?: string; // from signing in, for a faster download
  onGame?: (count: number) => void; // how many have arrived so far, as they do
  wait?: (ms: number) => Promise<unknown>; // for the tests
}

// Your games of the given kinds, newest first.
export async function downloadGames(
  username: string,
  speeds: Speed[],
  { since, token, onGame = () => {}, wait = sleep }: DownloadOptions = {},
): Promise<LichessGameJson[]> {
  const params = new URLSearchParams({
    perfType: speeds.join(','),
    evals: 'true', // the computer analysis, for games that have it
    clocks: 'true', // clock times, for the player strips
    accuracy: 'true', // each player's accuracy, when analysed
    opening: 'true', // the opening's name
    division: 'true', // where the middlegame and endgame start (deck.ts inOpening)
  });
  if (since !== undefined) params.set('since', String(since));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`;
  let waited = false;
  for (;;) {
    const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers });
    if (response.status === 401 && token) {
      token = undefined; // a sign-in Lichess no longer accepts, e.g. one cancelled there: download without it
      continue;
    }
    if (response.status === 429 && !waited) {
      waited = true;
      await wait(60_000);
      continue;
    }
    if (response.status === 429) throw new Error('Lichess says too many requests. Try again in a few minutes.');
    // 404 is also what Lichess answers some automated clients, so this doesn't claim the name is wrong.
    if (response.status === 404) throw new Error(`Lichess didn't find games for ${username}. Is the name right?`);
    if (!response.ok || !response.body) throw new Error(`Couldn't download your games from Lichess (${response.status}).`);
    return readGames(response.body, onGame);
  }
}

// The games of the given kinds you don't have yet, for "Update deck": for kinds you have games of,
// those since the newest of each, in one request (a few may come twice, which saveGames leaves
// out); for kinds you have none of yet, e.g. just added to your choice, all of them, in another.
export async function downloadNewGames(
  username: string,
  speeds: Speed[],
  saved: LichessGameJson[],
  { token, onGame = () => {} }: Pick<DownloadOptions, 'token' | 'onGame'> = {},
): Promise<LichessGameJson[]> {
  const have = speeds.filter(s => saved.some(g => g.speed === s));
  const none = speeds.filter(s => !have.includes(s));
  const since = Math.min(...have.map(s => sinceNewest(saved.filter(g => g.speed === s))!));
  const recent = have.length ? await downloadGames(username, have, { since, token, onGame }) : [];
  const all = none.length ? await downloadGames(username, none, { token, onGame: n => onGame(recent.length + n) }) : [];
  return [...recent, ...all];
}

// NDJSON, read as it arrives: one game's JSON per line.
async function readGames(body: ReadableStream<Uint8Array>, onGame: (count: number) => void): Promise<LichessGameJson[]> {
  const games: LichessGameJson[] = [];
  const add = (line: string) => {
    if (!line.trim()) return;
    games.push(JSON.parse(line));
    onGame(games.length);
  };
  const reader = body.getReader();
  const decoder = new TextDecoder(); // with stream: true, it keeps a letter split between two pieces
  let partial = ''; // what came after the last complete line, until the rest of it arrives
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = (partial + decoder.decode(value, { stream: true })).split('\n');
    partial = lines.pop()!;
    lines.forEach(add);
  }
  add(partial + decoder.decode());
  return games;
}
