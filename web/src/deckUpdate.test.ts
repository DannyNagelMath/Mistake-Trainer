// deckUpdate.test.ts: checks "Update deck" (deckUpdate.ts, and in Training settings,
// settingsPageView.ts renderYourDeck): downloading your new games, building the deck in the page,
// the masters check when you're signed in, and what the page says. The dev server, Lichess, and the
// masters database are stand-ins.
import type { VNode } from 'snabbdom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import { cardsOfGame, type Deck } from './deck';
import { DeckUpdateCtrl } from './deckUpdate';
import type { Speed } from './gameDownload';
import type { ReviewHistory } from './reviews';
import { defaultSettings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view } from './settingsPageView';
import type { LichessGameJson } from './tree';
import { YourGamesCtrl } from './yourGames';

const game = real1 as unknown as LichessGameJson; // a blitz game; your mistakes at plies 39, 41, and 63
const deck: Deck = { username: 'mugglesman1982', builtAt: '2026-10-28T17:33:10.000Z', games: { [game.id]: game }, cards: cardsOfGame(game, 'white') };

// What the dev server has, what Lichess sends, and what the page asked for and saved.
let saved: LichessGameJson[];
let fromLichess: LichessGameJson[] | number; // the games, or an error status
let answers: Record<string, unknown>;
let asked: string[];
let posted: Record<string, unknown[]>;
beforeEach(() => {
  saved = [];
  fromLichess = [game];
  answers = {};
  asked = [];
  posted = { '/api/games': [], '/api/masters': [], '/api/deck': [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const address = String(url);
      asked.push(`${init?.method ?? 'GET'} ${address.split('?')[0]}`);
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        posted[address].push(body);
        if (address === '/api/games') saved = [...saved, ...body.games];
        return new Response(null, { status: 204 });
      }
      if (address === '/api/games') return Response.json(saved);
      if (address === '/api/analysis') return Response.json({});
      if (address === '/api/masters') return Response.json(answers);
      if (address.startsWith('https://lichess.org/api/games/user/')) {
        if (typeof fromLichess === 'number') return Response.json({}, { status: fromLichess });
        return new Response(fromLichess.map(g => JSON.stringify(g) + '\n').join(''));
      }
      if (address.startsWith('https://explorer.lichess.org/masters')) return Response.json({ moves: [] });
      throw new Error(`Unexpected ${address}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const textOf = (v: VNode | string | undefined): string =>
  typeof v === 'string' ? v : !v ? '' : (v.text ?? '') + (v.children ?? []).map(c => textOf(c as VNode)).join(' ');
const find = (v: VNode | string | undefined, sel: string): VNode | undefined =>
  typeof v !== 'object' || !v ? undefined : v.sel === sel ? v : (v.children ?? []).map(c => find(c as VNode, sel)).find(Boolean);

const history: ReviewHistory = { cards: {}, log: [] };
const section = (update: DeckUpdateCtrl) =>
  find(
    view(new SettingsPageCtrl(deck, history, defaultSettings, () => {}, () => {}, new YourGamesCtrl(deck.username, () => defaultSettings.gameTypes, () => {}), update)),
    'section.mt-your-deck',
  );
const update = (speeds: Speed[] = ['blitz', 'rapid']) => new DeckUpdateCtrl('mugglesman1982', () => speeds, () => {});

test('Your deck says when it was built, and what "Update deck" does, and offers it', () => {
  const text = textOf(section(update()));
  expect(text).toContain(`Built ${new Date(deck.builtAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}`);
  expect(text).toContain('“Update deck” downloads the games you’ve played since from Lichess');
  expect(textOf(find(section(update()), 'button.button'))).toBe('Update deck');
});

test('it downloads your new games and saves them, builds the deck in the page, saves it, and counts the cards', async () => {
  const u = update();
  await u.start();
  expect(u.state).toBe('done');
  expect(asked).toEqual([
    'GET /api/games',
    'GET https://lichess.org/api/games/user/mugglesman1982',
    'POST /api/games',
    'GET /api/games',
    'GET /api/analysis',
    'GET /api/masters',
    'POST /api/deck',
  ]);
  expect(posted['/api/games']).toEqual([{ games: [game] }]);
  const built = posted['/api/deck'][0] as Deck;
  expect(built.cards.map(c => c.id)).toEqual(deck.cards.map(c => c.id));
  expect(u.built).toEqual(built);
  expect(u.lines).toEqual(['Downloaded 1 new game from Lichess.', 'Building your deck...', 'Built: 3 cards from 1 game.']);
  const done = section(u);
  expect(textOf(done)).toContain('Done: your deck now has 3 cards, as many as before. Reload the page to train with them.');
  expect(textOf(find(done, 'button.button'))).toBe('Reload');
  expect(textOf(find(done, 'pre.mt-your-deck__log'))).toBe(u.lines.join('\n'));
});

test('an update asks Lichess only for the games since your newest saved one', async () => {
  saved = [game];
  fromLichess = [];
  const u = update();
  await u.start();
  expect(u.lines[0]).toBe('Downloaded 0 new games from Lichess.');
  const lichess = vi.mocked(fetch).mock.calls.map(c => String(c[0])).filter(a => a.startsWith('https://lichess.org')).map(a => new URL(a));
  // Blitz since your newest blitz game; rapid, of which you have none yet, all of them.
  expect(lichess.map(u => [u.searchParams.get('perfType'), u.searchParams.get('since')])).toEqual([
    ['blitz', String(game.createdAt! + 1)],
    ['rapid', null],
  ]);
});

test('new opening positions: signed out, skipped, and it says so; signed in, asked about and saved', async () => {
  fromLichess = [{ ...game, division: { middle: 40, end: 80 } }]; // makes ply 39 an opening mistake
  const signedOut = update();
  await signedOut.start();
  expect(asked.filter(a => a.includes('explorer'))).toEqual([]);
  expect(signedOut.lines.at(-1)).toBe(
    '1 new opening position wasn’t checked against the masters database. To check them, sign in with Lichess, then update again.',
  );

  saved = [];
  asked = [];
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ token: 'lio_T', username: 'MugglesMan1982' }) });
  const signedIn = update();
  await signedIn.start();
  expect(asked).toContain('GET https://explorer.lichess.org/masters');
  expect(posted['/api/masters']).toHaveLength(1);
  expect(signedIn.lines).toContain('Asking the masters database: 1 of 1...');
  expect(signedIn.lines.join(' ')).not.toContain('checked against');
});

test('if it fails, the page says your deck is as it was, and why, and offers to try again', async () => {
  fromLichess = 404;
  const u = update();
  await u.start();
  expect(u.state).toBe('failed');
  expect(asked).not.toContain('POST /api/deck');
  const text = textOf(section(u));
  expect(text).toContain('The update stopped, so your deck is as it was.');
  expect(text).toContain("Lichess didn't find games for mugglesman1982. Is the name right?");
  expect(textOf(find(section(u), 'button.button'))).toBe('Update deck');
});

test('one update at a time', async () => {
  const u = update();
  await Promise.all([u.start(), u.start()]);
  expect(asked.filter(a => a.startsWith('GET https://lichess.org'))).toHaveLength(1);
});

test('only the kinds of games you chose are downloaded, and make cards', async () => {
  const u = update(['rapid', 'classical']);
  await u.start(); // the stand-in sends the blitz game anyway, which Lichess wouldn't
  const lichess = vi.mocked(fetch).mock.calls.map(c => String(c[0])).filter(a => a.startsWith('https://lichess.org'));
  expect(lichess.map(a => new URL(a).searchParams.get('perfType'))).toEqual(['rapid,classical']);
  expect((posted['/api/deck'][0] as Deck).cards).toEqual([]);
  expect(u.lines.at(-1)).toBe('Built: 0 cards from 0 games.');
});
