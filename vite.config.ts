// vite.config.ts: Vite's settings. Step 9: adds addresses to the dev server, so the pages can keep
// your data in files in data/ (gitignored), instead of in the browser:
//   GET  /api/reviews   returns your review history (an empty one if the file doesn't exist yet)
//   POST /api/reviews   with { card, entry } saves one review: the card's new schedule and its
//                       log entry; with { suspend, at } suspends the card with that id, and with
//                       { unsuspend } brings it back (see reviews.ts)
//   GET  /api/settings  returns your settings ({} if you haven't saved any yet)
//   POST /api/settings  replaces them (see settings.ts, which checks them when a page loads them)
//   GET  /api/analysis  returns the analyses made on your computer, by game ({} if none yet)
//   POST /api/analysis  with { gameId, analysis, engine, nodes, at } saves one (see analyses.ts)
//   GET  /api/games     returns the games downloaded from Lichess (gameDownload.ts), one per line
//   POST /api/games     with { games } adds those it doesn't have yet
//   GET  /api/masters   returns the masters database's answers, by position ({} if none yet)
//   POST /api/masters   with { fen, moves } saves one (see mastersExplorer.ts)
//   GET  /api/deck      returns the deck (null until the first is built; see deckUpdate.ts)
//   POST /api/deck      replaces it
//   POST /api/import    replaces everything with what an exported file holds (see backup.ts), after
//                       copying the files there are to data/backups
// It also serves Stockfish to the page at /stockfish/ (see stockfishFiles below), and makes the
// pages "cross-origin isolated" so that it can run on several threads (crossOriginIsolation).
// They only exist in the dev server (npm run dev), which is how this app runs.
// To start your review history again, delete data/reviews.json; to go back to the default
// settings, delete data/settings.json. To use other files, e.g. for testing, set the
// REVIEWS_FILE, SETTINGS_FILE, ANALYSIS_FILE, GAMES_FILE, MASTERS_FILE, and DECK_FILE environment
// variables to their paths.
// Your review history is backed up once a day (backupHistory below).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

import type { SavedAnalysis } from './src/analyses.ts';
import type { ReviewEntry, ReviewHistory } from './src/reviews.ts';

const dataFile = (name: string) => fileURLToPath(new URL(`./data/${name}`, import.meta.url));
const historyFile = process.env.REVIEWS_FILE ?? dataFile('reviews.json');
const settingsFile = process.env.SETTINGS_FILE ?? dataFile('settings.json');
const analysisFile = process.env.ANALYSIS_FILE ?? dataFile('analysis.json');
const gamesFile = process.env.GAMES_FILE ?? dataFile('games.ndjson');
const mastersFile = process.env.MASTERS_FILE ?? dataFile('masters.json');
const deckFile = process.env.DECK_FILE ?? dataFile('deck.json');

const readJson = <T>(file: string, empty: T): T => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty);

// Writes a temporary file, then renames it over the old one, so that a crash halfway through
// can't leave a half-written file.
function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
  renameSync(file + '.tmp', file);
}

const readHistory = (): ReviewHistory => readJson(historyFile, { cards: {}, log: [] });

// NDJSON, as the games are downloaded: one game's JSON per line.
const readGames = (): { id: string }[] =>
  existsSync(gamesFile)
    ? readFileSync(gamesFile, 'utf8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
    : [];

// The games, one per line, in a temporary file renamed over the old one, as writeJson does.
function writeGames(games: { id: string }[]): void {
  mkdirSync(dirname(gamesFile), { recursive: true });
  writeFileSync(gamesFile + '.tmp', games.map(g => JSON.stringify(g) + '\n').join(''));
  renameSync(gamesFile + '.tmp', gamesFile);
}

// Adds games the page downloaded (gameDownload.ts) to the file, leaving out any it has already.
function addGames(games: { id: string }[]): void {
  const saved = readGames();
  const known = new Set(saved.map(g => g.id));
  writeGames([...saved, ...games.filter(g => !known.has(g.id))]);
}

// The deck, as writeJson would, but without its spacing: it's large.
function writeDeck(deck: unknown): void {
  mkdirSync(dirname(deckFile), { recursive: true });
  writeFileSync(deckFile + '.tmp', JSON.stringify(deck));
  renameSync(deckFile + '.tmp', deckFile);
}

// Import (backup.ts): everything replaced with a file's, after copying the files there are now to
// data/backups/before-import-<date and time>, e.g. before-import-2026-10-30T18-04-33.
function importAll(data: {
  reviews: unknown;
  settings: unknown;
  analyses: unknown;
  games: { id: string }[];
  masters: unknown;
  deck: unknown;
}): void {
  const now = new Date();
  const [date, time] = [
    [now.getFullYear(), now.getMonth() + 1, now.getDate()],
    [now.getHours(), now.getMinutes(), now.getSeconds()],
  ].map(parts => parts.map(n => String(n).padStart(2, '0')).join('-'));
  const dir = join(dirname(historyFile), 'backups', `before-import-${date}T${time}`); // your time, as the daily backups
  mkdirSync(dir, { recursive: true });
  for (const file of [historyFile, settingsFile, analysisFile, gamesFile, mastersFile, deckFile])
    if (existsSync(file)) copyFileSync(file, join(dir, basename(file)));
  writeJson(historyFile, data.reviews);
  writeJson(settingsFile, data.settings);
  writeJson(analysisFile, data.analyses);
  writeJson(mastersFile, data.masters);
  writeGames(data.games);
  if (data.deck) writeDeck(data.deck);
  else rmSync(deckFile, { force: true }); // no deck: the first-run screen builds one
}

// Backs up your review history once a day: a copy in data/backups, named by the date, made the
// first time the dev server starts or saves a review that day, before anything changes. The 30
// latest stay; older ones are deleted. To go back to one, stop the dev server and copy it over
// data/reviews.json. (Only files named like these backups are ever deleted.)
const BACKUPS_KEPT = 30;
function backupHistory(): void {
  if (!existsSync(historyFile)) return;
  const dir = join(dirname(historyFile), 'backups');
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(n => String(n).padStart(2, '0')).join('-');
  const backup = join(dir, `reviews-${today}.json`);
  if (existsSync(backup)) return;
  mkdirSync(dir, { recursive: true });
  copyFileSync(historyFile, backup);
  const backups = readdirSync(dir)
    .filter(name => /^reviews-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort(); // oldest first, as the dates sort as text
  for (const old of backups.slice(0, -BACKUPS_KEPT)) rmSync(join(dir, old));
}

// A request handler: GET replies with get(), as JSON; POST calls post() with the JSON the page
// sent, which returns an error message if the request makes no sense. The files are read and
// written with the synchronous functions, so two saves can't interleave.
function handler(get: () => unknown, post: (body: any) => string | undefined) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: string, type = 'text/plain') => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.end(body);
    };
    if (req.method === 'GET') {
      try {
        return reply(200, JSON.stringify(get()), 'application/json');
      } catch (e) {
        return reply(500, String(e));
      }
    }
    if (req.method !== 'POST') return reply(405, 'Only GET and POST');
    let body = ''; // a request's body arrives in pieces
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const error = post(JSON.parse(body));
        if (error) reply(400, error);
        else reply(204, '');
      } catch (e) {
        reply(500, String(e));
      }
    });
  };
}

// A Vite plugin: configureServer runs when the dev server starts, and middlewares.use adds a
// handler for requests to each address.
function dataApi(): Plugin {
  return {
    name: 'data-api',
    configureServer(server) {
      backupHistory();
      server.middlewares.use(
        '/api/reviews',
        handler(readHistory, body => {
          const { card, entry, suspend, at, unsuspend } = body as {
            card?: ReviewHistory['cards'][string];
            entry?: ReviewEntry;
            suspend?: string;
            at?: string;
            unsuspend?: string;
          };
          const history = readHistory();
          if (typeof suspend === 'string') (history.suspended ??= {})[suspend] = at ?? new Date().toISOString();
          else if (typeof unsuspend === 'string') delete history.suspended?.[unsuspend];
          else if (card && typeof entry?.cardId === 'string') {
            history.cards[entry.cardId] = card;
            history.log.push(entry);
          } else return 'Expected { card, entry }, { suspend, at }, or { unsuspend }';
          backupHistory(); // before the day's first change, if the dev server has been running since yesterday
          writeJson(historyFile, history);
        }),
      );
      server.middlewares.use(
        '/api/settings',
        handler(
          () => readJson(settingsFile, {}),
          body => {
            if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'Expected the settings';
            writeJson(settingsFile, body);
          },
        ),
      );
      server.middlewares.use(
        '/api/analysis',
        handler(
          () => readJson(analysisFile, {}),
          body => {
            const { gameId, ...saved } = body as { gameId?: string } & SavedAnalysis;
            if (typeof gameId !== 'string' || !Array.isArray(saved.analysis))
              return 'Expected { gameId, analysis, engine, nodes, at }';
            const analyses = readJson<Record<string, SavedAnalysis>>(analysisFile, {});
            analyses[gameId] = saved;
            writeJson(analysisFile, analyses);
          },
        ),
      );
      server.middlewares.use(
        '/api/games',
        handler(readGames, body => {
          const { games } = body as { games?: { id: string }[] };
          if (!Array.isArray(games) || games.some(g => typeof g?.id !== 'string')) return 'Expected { games: [...] }';
          addGames(games);
          return undefined;
        }),
      );
      server.middlewares.use(
        '/api/masters',
        handler(
          () => readJson(mastersFile, {}),
          body => {
            const { fen, moves } = body as { fen?: string; moves?: unknown };
            if (typeof fen !== 'string' || !Array.isArray(moves)) return 'Expected { fen, moves }';
            writeJson(mastersFile, { ...readJson<Record<string, unknown>>(mastersFile, {}), [fen]: moves });
            return undefined;
          },
        ),
      );
      server.middlewares.use(
        '/api/deck',
        handler(
          () => readJson(deckFile, null),
          body => {
            if (typeof body?.username !== 'string' || !Array.isArray(body.cards)) return 'Expected a deck';
            writeDeck(body);
            return undefined;
          },
        ),
      );
      server.middlewares.use(
        '/api/import',
        handler(
          () => null,
          body => {
            const ok = body?.reviews && body.settings && body.analyses && Array.isArray(body.games) && body.masters;
            if (!ok) return 'Expected everything an export holds';
            importAll(body);
            return undefined;
          },
        ),
      );
    },
  };
}

// The two settings that make a page "cross-origin isolated", which lets Stockfish run on several
// threads (WebAssembly threads need SharedArrayBuffer, which browsers only allow in such pages).
// The price: a page can't embed anything from another site, and ours don't. Links to other
// sites, like lichess.org, work as before.
const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

// A Vite plugin that adds those settings to every response: added first (configureServer), its
// handler sees every request before the others.
function crossOriginIsolation(): Plugin {
  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        for (const [name, value] of Object.entries(ISOLATION)) res.setHeader(name, value);
        next();
      });
    },
  };
}

// Serves the Stockfish engine files (src/engine.ts) at /stockfish/, straight from the npm package
// `stockfish`, so they're always the installed version. Only files named like its engines, and
// with the content types the browser needs to run them. The browser may keep them for a day:
// the full engine is about 100 MB.
const stockfishDir = fileURLToPath(new URL('./node_modules/stockfish/bin/', import.meta.url));
function stockfishFiles(): Plugin {
  const dir = stockfishDir;
  return {
    name: 'stockfish-files',
    configureServer(server) {
      server.middlewares.use('/stockfish/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!/^stockfish-[\w.-]+\.(js|wasm)$/.test(name) || !existsSync(dir + name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.setHeader('Cache-Control', 'max-age=86400');
        res.end(readFileSync(dir + name));
      });
    },
  };
}

// For the website (npm run build): the lite engines (src/engine.ts), copied into the build at
// /stockfish/, with Stockfish's licence, which the GPL asks to go with them.
function stockfishBuild(): Plugin {
  const files = {
    'stockfish-19-lite.js': 'stockfish-19-lite.js',
    'stockfish-19-lite.wasm': 'stockfish-19-lite.wasm',
    'stockfish-19-lite-single.js': 'stockfish-19-lite-single.js',
    'stockfish-19-lite-single.wasm': 'stockfish-19-lite-single.wasm',
    'Copying.txt': '../Copying.txt', // the GPL's text
  };
  return {
    name: 'stockfish-build',
    apply: 'build',
    generateBundle() {
      for (const [name, from] of Object.entries(files))
        this.emitFile({ type: 'asset', fileName: `stockfish/${name}`, source: readFileSync(stockfishDir + from) });
    },
  };
}

export default defineConfig({
  plugins: [crossOriginIsolation(), dataApi(), stockfishFiles(), stockfishBuild()],
  preview: { headers: ISOLATION }, // npm run preview: the built website, with the headers it has on Cloudflare (public/_headers)
});
