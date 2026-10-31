// browserStorage.ts: Not in lila. Your data on the website, in the browser's IndexedDB, which holds
// far more than localStorage. Reviews, settings, and the deck are one entry each in "data"; games,
// analyses, and the masters' answers have a store each, with an entry per game or position.

import type { ReviewHistory } from './reviews';
import { parseSettings } from './settings';
import type { Storage } from './storage';

type StoreName = 'data' | 'games' | 'analyses' | 'masters';
const STORES: StoreName[] = ['data', 'games', 'analyses', 'masters'];

let database: Promise<IDBDatabase> | undefined;
const open = (): Promise<IDBDatabase> =>
  (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('mistake-trainer', 1);
    request.onupgradeneeded = () => STORES.forEach(name => request.result.createObjectStore(name)); // the first time
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));

const result = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Runs `work` in one transaction on the stores, all or nothing, and waits until it's stored.
async function transaction<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  work: (store: (name: StoreName) => IDBObjectStore) => Promise<T>,
): Promise<T> {
  const tx = (await open()).transaction(names, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
  done.catch(() => {}); // what goes wrong is thrown below, not reported twice
  const value = await work(name => tx.objectStore(name));
  await done;
  return value;
}

const getOne = <T>(store: StoreName, key: string): Promise<T | undefined> =>
  transaction([store], 'readonly', s => result(s(store).get(key)));
const putOne = (store: StoreName, key: string, value: unknown): Promise<void> =>
  transaction([store], 'readwrite', async s => void (await result(s(store).put(value, key))));

// All of a store's entries, by key.
const getAllByKey = <T>(store: StoreName): Promise<Record<string, T>> =>
  transaction([store], 'readonly', async s => {
    const [keys, values] = await Promise.all([result(s(store).getAllKeys()), result(s(store).getAll())]);
    return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  });

// Changes your review history, reading and writing it in one transaction.
const changeHistory = (change: (history: ReviewHistory) => void): Promise<void> =>
  transaction(['data'], 'readwrite', async s => {
    const history: ReviewHistory = (await result(s('data').get('reviews'))) ?? { cards: {}, log: [] };
    change(history);
    await result(s('data').put(history, 'reviews'));
  });

export const browserStorage: Storage = {
  loadHistory: async () => (await getOne<ReviewHistory>('data', 'reviews')) ?? { cards: {}, log: [] },
  saveReview: (card, entry) =>
    changeHistory(h => {
      h.cards[entry.cardId] = card;
      h.log.push(entry);
    }),
  saveSuspension: (cardId, at) => changeHistory(h => void ((h.suspended ??= {})[cardId] = at)),
  saveUnsuspension: cardId => changeHistory(h => void delete h.suspended?.[cardId]),
  loadSettings: async () => parseSettings((await getOne('data', 'settings')) ?? {}),
  saveSettings: s => putOne('data', 'settings', s),
  loadAnalyses: () => getAllByKey('analyses'),
  saveAnalysis: (gameId, saved) => putOne('analyses', gameId, saved),
  loadGames: async () => Object.values(await getAllByKey('games')),
  saveGames: games =>
    transaction(['games'], 'readwrite', async s => {
      const have = new Set(await result(s('games').getAllKeys()));
      for (const game of games) if (!have.has(game.id)) s('games').put(game, game.id);
    }),
  loadMasters: () => getAllByKey('masters'),
  saveMasterMoves: (fen, moves) => putOne('masters', fen, moves),
  loadDeck: () => getOne('data', 'deck'),
  saveDeck: deck => putOne('data', 'deck', deck),
  replaceAll: data =>
    transaction(STORES, 'readwrite', async s => {
      for (const name of STORES) s(name).clear();
      s('data').put(data.reviews, 'reviews');
      s('data').put(data.settings, 'settings');
      if (data.deck) s('data').put(data.deck, 'deck');
      for (const game of data.games) s('games').put(game, game.id);
      for (const [gameId, saved] of Object.entries(data.analyses)) s('analyses').put(saved, gameId);
      for (const [fen, moves] of Object.entries(data.masters)) s('masters').put(moves, fen);
    }),
};
