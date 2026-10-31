// deckUpdate.test.ts: checks "Update deck" (deckUpdate.ts, and in Training settings,
// settingsPageView.ts renderYourDeck): downloading your new games, building the deck in the page,
// that it asks the masters database nothing, and what the page says. The dev server, Lichess, and the
// masters database are stand-ins.
import type { VNode } from 'snabbdom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import { cardsOfGame, mistakeOf, type Deck } from './deck';
import { DeckUpdateCtrl } from './deckUpdate';
import type { Speed } from './gameDownload';
import type { ReviewHistory } from './reviews';
import { defaultSettings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view } from './settingsPageView';
import type { LichessGameJson } from './tree';
import { YourGamesCtrl } from './yourGames';

const game = real1 as unknown as LichessGameJson; // a blitz game; your mistakes at plies 39, 41, and 63
const deck: Deck = { username: 'mugglesman1982', builtAt: '2026-10-28T17:33:10.000Z', games: { [game.id]: game }, cards: cardsOfGame(game, 'white'), gameTimes: [game.createdAt!] };

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
  posted = { '/api/games': [], '/api/masters': [], '/api/deck': [], '/api/settings': [] };
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

test('Update deck asks the masters database nothing: saved answers apply, and new positions wait for their card', async () => {
  const opening = { ...game, division: { middle: 40, end: 80 } }; // makes ply 39 an opening mistake
  fromLichess = [opening];
  await update().start();
  expect(asked.filter(a => a.includes('explorer'))).toEqual([]);
  expect((posted['/api/deck'][0] as Deck).cards.map(c => c.ply)).toEqual([39, 41, 63]); // ply 39 kept, unchecked

  // With an answer saved for it, which makes it a book move, its card goes.
  const { fen, uci } = mistakeOf(opening, cardsOfGame(opening, 'white')[0]);
  answers = { [fen]: [{ uci, white: 2, draws: 0, black: 0 }] };
  saved = [];
  posted['/api/deck'] = [];
  await update().start();
  expect((posted['/api/deck'][0] as Deck).cards.map(c => c.ply)).toEqual([41, 63]);
  expect(asked.filter(a => a.includes('explorer'))).toEqual([]);
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

test('Games, beside Update deck: what you tick is saved, and passed to the trainer, when you press it', async () => {
  let trainers = defaultSettings; // the trainer's settings, which the update reads its kinds from
  const u = new DeckUpdateCtrl('mugglesman1982', () => trainers.gameTypes, () => {});
  const yourGames = new YourGamesCtrl(deck.username, () => trainers.gameTypes, () => {});
  const page = new SettingsPageCtrl(deck, history, defaultSettings, () => {}, s => (trainers = s), yourGames, u);
  const yourDeck = () => find(view(page), 'section.mt-your-deck');
  expect(textOf(yourDeck())).not.toContain('Press “Update deck” to apply your choice.');

  page.chooseGameTypes([]);
  expect(textOf(yourDeck())).toContain('Choose at least one.');
  expect(find(yourDeck(), 'button.button')!.data!.attrs!.disabled).toBe(true);
  await page.updateDeck();
  expect(asked).toEqual([]); // nothing done

  page.chooseGameTypes(['rapid']);
  expect(textOf(yourDeck())).toContain('Press “Update deck” to apply your choice.');
  expect(page.changed()).toBe(false); // the form's own Save isn't for this
  await page.updateDeck();
  expect(posted['/api/settings']).toEqual([{ ...defaultSettings, gameTypes: ['rapid'] }]);
  expect(trainers.gameTypes).toEqual(['rapid']);
  const lichess = vi.mocked(fetch).mock.calls.map(c => String(c[0])).filter(a => a.startsWith('https://lichess.org'));
  expect(lichess.map(a => new URL(a).searchParams.get('perfType'))).toEqual(['rapid']);
  expect(textOf(yourDeck())).not.toContain('to apply your choice');
});
