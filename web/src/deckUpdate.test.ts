// deckUpdate.test.ts: checks "Update deck" in Training settings (deckUpdate.ts, and settingsPageView.ts
// renderYourDeck): starting it, following it while it runs, and what the page says once it's done, or
// if it failed. The dev server's answers are stubbed, and the clock that asks every second is a fake.
import type { VNode } from 'snabbdom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import { cardsOfGame, type Deck } from './deck';
import { DeckUpdateCtrl, failureReason, type DeckUpdate } from './deckUpdate';
import type { ReviewHistory } from './reviews';
import { defaultSettings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view } from './settingsPageView';
import type { LichessGameJson } from './tree';
import { YourGamesCtrl } from './yourGames';

const game = real1 as unknown as LichessGameJson;
const deck: Deck = {
  username: 'mugglesman1982',
  builtAt: '2026-10-28T17:33:10.000Z',
  games: { [game.id]: game },
  cards: cardsOfGame(game, 'white'),
};
const startedAt = '2026-10-29T10:00:00.000Z';
const newDeck: Deck = { ...deck, builtAt: '2026-10-29T10:00:30.000Z', cards: [...deck.cards, { ...deck.cards[0], id: 'new/1' }] };

// The dev server: how the update stands (each test changes it), starting it, and the deck it built.
let status: DeckUpdate;
let asked: string[]; // what the page asked for
const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => body });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  status = { state: 'idle', lines: [] };
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/update-deck' && init?.method === 'POST') {
        if (status.state !== 'running') status = { state: 'running', lines: [], startedAt };
        return { ok: true, status: 204 };
      }
      if (url === '/api/update-deck') return json(status);
      if (url === '/data/deck.json') return json(newDeck);
      throw new Error(`Unexpected ${url}`);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const textOf = (v: VNode | string | undefined): string =>
  typeof v === 'string' ? v : !v ? '' : (v.text ?? '') + (v.children ?? []).map(c => textOf(c as VNode)).join(' ');
const find = (v: VNode | string | undefined, sel: string): VNode | undefined =>
  typeof v !== 'object' || !v ? undefined : v.sel === sel ? v : (v.children ?? []).map(c => find(c as VNode, sel)).find(Boolean);
const click = (v: VNode | undefined): unknown => (v!.data!.on!.click as () => unknown)();

const history: ReviewHistory = { cards: {}, log: [] };
const section = (update: DeckUpdateCtrl) =>
  find(
    view(new SettingsPageCtrl(deck, history, defaultSettings, () => {}, () => {}, new YourGamesCtrl(deck.username, () => {}), update)),
    'section.mt-your-deck',
  );
const button = (update: DeckUpdateCtrl) => find(section(update), 'button.button');
// A second goes by, and the dev server's answer comes in: advancing the clock this way also lets what
// was waiting for an answer carry on.
const aSecond = () => vi.advanceTimersByTimeAsync(1000);

test('it says when your deck was built, and what "Update deck" does', async () => {
  const update = new DeckUpdateCtrl(deck.builtAt, () => {});
  await update.load();
  const built = new Date(deck.builtAt);
  const text = textOf(section(update));
  expect(text).toContain(
    `Built ${built.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ` +
      `at ${built.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
  );
  expect(text).toContain('“Update deck” downloads the games you’ve played since from Lichess, then builds your deck again');
  expect(textOf(button(update))).toBe('Update deck');
  expect(find(section(update), 'pre.mt-your-deck__log')).toBeUndefined();
});

test('while it runs, the page shows what it prints, asking every second; once done, it counts the new cards', async () => {
  const update = new DeckUpdateCtrl(deck.builtAt, () => {});
  await update.load();
  await click(button(update));
  expect(asked).toEqual(['GET /api/update-deck', 'POST /api/update-deck', 'GET /api/update-deck']);
  expect(textOf(button(update))).toBe('Updating…');
  expect(button(update)!.data!.attrs!.disabled).toBe(true);

  status = { ...status, lines: ['Downloading your new games...', 'Added 3 new games to games.ndjson.'] };
  await aSecond();
  expect(textOf(find(section(update), 'pre.mt-your-deck__log'))).toBe(status.lines.join('\n'));

  status = { ...status, state: 'done', lines: [...status.lines, 'public/data/deck.json: 32 cards from 1 games'] };
  await aSecond();
  expect(asked.at(-1)).toBe('GET /data/deck.json'); // the new deck, to count its cards
  expect(textOf(section(update))).toContain(
    `Done: your deck now has ${newDeck.cards.length} cards, 1 more than before. Reload the page to train with them.`,
  );
  expect(textOf(button(update))).toBe('Reload');
  expect(textOf(find(section(update), 'pre.mt-your-deck__log'))).toContain('32 cards from 1 games');

  const before = asked.length;
  await aSecond();
  expect(asked).toHaveLength(before); // it has stopped asking
});

test('if the update fails, the page says your deck is as it was, and why, shows what it printed, and offers to try again', async () => {
  status = { state: 'failed', lines: ['Building the deck...', 'Error: no token', '    at ask (x.ts:53:13)'], startedAt, endedAt: startedAt };
  const update = new DeckUpdateCtrl(deck.builtAt, () => {});
  await update.load();
  const message = textOf(find(section(update), 'p.mt-run__error'));
  expect(message).toContain('The update stopped, so your deck is as it was.');
  expect(message).toContain('Error: no token');
  expect(textOf(find(section(update), 'pre.mt-your-deck__log'))).toBe(status.lines.join('\n'));
  expect(textOf(button(update))).toBe('Update deck');

  status = { ...status, lines: ['Building the deck...', 'Killed'] }; // nothing says why
  await update.load();
  expect(textOf(find(section(update), 'p.mt-run__error')).replace(/\s+/g, ' ')).toBe(
    'The update stopped, so your deck is as it was. What it printed is below.',
  );
});

test("the reason a failed update gives: Node's error line, or the last line of Python's", () => {
  const node = ["      throw new Error('No token');", '', 'Error: No token', '    at MastersExplorer.ask (x.ts:53:13)', '', 'Node.js v24.21.0'];
  expect(failureReason(['Building the deck...', ...node])).toBe('Error: No token');
  const python = [
    'Traceback (most recent call last):',
    '  File "save_my_games.py", line 80, in <module>',
    '    response.raise_for_status()',
    'requests.exceptions.HTTPError: 429 Client Error: Too Many Requests for url: https://lichess.org/api/games/user/x',
  ];
  expect(failureReason(['Downloading your new games...', ...python])).toBe(python[3]);
  expect(failureReason(['Downloading your new games...'])).toBeUndefined();
});

test('once the page has the deck an update built, there is nothing more to say about that update', async () => {
  status = { state: 'done', lines: ['public/data/deck.json: 32 cards from 1 games'], startedAt, endedAt: startedAt };
  const update = new DeckUpdateCtrl(newDeck.builtAt, () => {}); // the page loaded the new deck
  await update.load();
  expect(textOf(section(update))).not.toContain('Done');
  expect(textOf(button(update))).toBe('Update deck');
  expect(find(section(update), 'pre.mt-your-deck__log')).toBeUndefined();
  expect(asked).toEqual(['GET /api/update-deck']); // no need to load the deck
});

test('a dev server started before "Update deck" was added: it says to restart it', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, headers: new Headers({ 'Content-Type': 'text/html' }) }));
  const update = new DeckUpdateCtrl(deck.builtAt, () => {});
  await update.load();
  expect(textOf(section(update))).toContain('Restart the dev server (npm run dev).');
});
