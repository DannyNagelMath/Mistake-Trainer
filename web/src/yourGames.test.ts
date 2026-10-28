// yourGames.test.ts: checks "Computer analysis" in Training settings (yourGames.ts): what it counts,
// and that its run analyses your games Lichess hasn't, newest first. The dev server's answers are
// stubbed, and the analysis (which needs Stockfish, so a browser) has a stand-in.
import type { VNode } from 'snabbdom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import real1 from '../fixtures/real1.json';
import { cardsOfGame, type Deck } from './deck';
import { DeckUpdateCtrl } from './deckUpdate';
import type { ReviewHistory } from './reviews';
import { defaultSettings } from './settings';
import { SettingsPageCtrl } from './settingsPage';
import { view } from './settingsPageView';
import type { LichessGameJson } from './tree';
import { YourGamesCtrl } from './yourGames';

// The stand-in analysis notes which game it analysed, and finds nothing.
const analysed = vi.hoisted(() => [] as string[]);
vi.mock('./localAnalysis', () => ({
  analyseGame: async (game: LichessGameJson) => {
    analysed.push(game.id);
    return [];
  },
}));

const game = real1 as unknown as LichessGameJson; // Lichess analysed it; you played White
const day = 24 * 60 * 60 * 1000;
const unanalysed = (id: string, createdAt: number): LichessGameJson => ({ ...game, id, createdAt, analysis: undefined });
const games = [
  game,
  unanalysed('older', game.createdAt! + day),
  unanalysed('newest', game.createdAt! + 3 * day),
  unanalysed('newer', game.createdAt! + 2 * day),
  { ...unanalysed('variant', game.createdAt!), variant: 'chess960' }, // not standard chess: left out
];

// The dev server: your games, the analyses saved so far (one: 'newer', before the deck was built),
// and saving.
let saves: string[]; // the games whose analyses were saved
beforeEach(() => {
  analysed.length = 0;
  saves = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/games') return json(games);
      if (init?.method === 'POST') {
        saves.push(JSON.parse(init.body as string).gameId);
        return new Response(null, { status: 204 });
      }
      return json({ newer: { analysis: [], engine: 'Stockfish 19', nodes: 1_000_000, at: '2026-09-30T12:00:00.000Z' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const textOf = (v: VNode | string | undefined): string =>
  typeof v === 'string' ? v : !v ? '' : (v.text ?? '') + (v.children ?? []).map(c => textOf(c as VNode)).join(' ');
const find = (v: VNode | string | undefined, sel: string): VNode | undefined =>
  typeof v !== 'object' || !v ? undefined : v.sel === sel ? v : (v.children ?? []).map(c => find(c as VNode, sel)).find(Boolean);

const deck: Deck = {
  username: 'mugglesman1982',
  builtAt: '2026-10-01T12:00:00.000Z',
  games: { [game.id]: game },
  cards: cardsOfGame(game, 'white'),
};
const history: ReviewHistory = { cards: {}, log: [] };
const section = (yourGames: YourGamesCtrl) =>
  find(
    view(new SettingsPageCtrl(deck, history, defaultSettings, () => {}, () => {}, yourGames, new DeckUpdateCtrl(deck.builtAt, () => {}))),
    'section.mt-computer-analysis',
  );

test('it counts your games, and the ones Lichess has analysed; the others are to analyse here, newest first', async () => {
  const yourGames = new YourGamesCtrl('mugglesman1982', () => {});
  expect(textOf(section(yourGames))).toContain('Loading your games…');
  await yourGames.load();
  expect(yourGames.loaded!.run.games.map(g => g.id)).toEqual(['newest', 'newer', 'older']);
  const text = textOf(section(yourGames));
  expect(text).toContain('Lichess has analysed 1 of your 4 games. The other 3 can be analysed here');
  expect(text).toContain('1 of 3 games analysed here.'); // 'newer', saved before
  expect(text).toContain('Your deck has the cards from all the games analysed here so far.');
  expect(textOf(find(section(yourGames), 'button.button'))).toBe('Carry on');
});

test('carrying on analyses the games not analysed yet, newest first, and saves each', async () => {
  const yourGames = new YourGamesCtrl('mugglesman1982', () => {});
  await yourGames.load();
  await (find(section(yourGames), 'button.button')!.data!.on!.click as () => Promise<void>)();
  expect(analysed).toEqual(['newest', 'older']);
  expect(saves).toEqual(['newest', 'older']);
  expect(textOf(section(yourGames))).toContain('3 of 3 games analysed here.');
  expect(find(section(yourGames), 'button.button')).toBeUndefined(); // nothing left to do
  expect(textOf(section(yourGames))).toContain(
    'Games analysed here since your deck was built: 2. To add their cards, use “Update deck”, above.',
  );
});

test("if your games can't load, it says why, and tries again next time", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
  const yourGames = new YourGamesCtrl('mugglesman1982', () => {});
  await yourGames.load();
  expect(textOf(section(yourGames))).toContain("Couldn't load your downloaded games (404)");
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url === '/api/games' ? games : {}), { headers: { 'Content-Type': 'application/json' } })));
  await yourGames.load();
  expect(yourGames.loaded?.all).toBe(4);
  expect(textOf(section(yourGames))).not.toContain('your deck'); // nothing analysed here yet
});
