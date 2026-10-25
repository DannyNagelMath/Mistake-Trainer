// vite.config.ts: Vite's settings. Step 9: adds addresses to the dev server, so the pages can keep
// your data in files in data/ (gitignored), instead of in the browser:
//   GET  /api/reviews   returns your review history (an empty one if the file doesn't exist yet)
//   POST /api/reviews   with { card, entry } saves one review: the card's new schedule and its
//                       log entry; with { suspend, at } suspends the card with that id, and with
//                       { unsuspend } brings it back (see reviews.ts)
//   GET  /api/settings  returns your settings ({} if you haven't saved any yet)
//   POST /api/settings  replaces them (see settings.ts, which checks them when a page loads them)
// It also serves Stockfish to the page at /stockfish/ (see stockfishFiles below).
// They only exist in the dev server (npm run dev), which is how this app runs.
// To start your review history again, delete data/reviews.json; to go back to the default
// settings, delete data/settings.json. To use other files, e.g. for testing, set the
// REVIEWS_FILE and SETTINGS_FILE environment variables to their paths.
// Your review history is backed up once a day (backupHistory below).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

import type { ReviewEntry, ReviewHistory } from './src/reviews.ts';

const dataFile = (name: string) => fileURLToPath(new URL(`./data/${name}`, import.meta.url));
const historyFile = process.env.REVIEWS_FILE ?? dataFile('reviews.json');
const settingsFile = process.env.SETTINGS_FILE ?? dataFile('settings.json');

const readJson = <T>(file: string, empty: T): T => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty);

// Writes a temporary file, then renames it over the old one, so that a crash halfway through
// can't leave a half-written file.
function writeJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
  renameSync(file + '.tmp', file);
}

const readHistory = (): ReviewHistory => readJson(historyFile, { cards: {}, log: [] });

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
    },
  };
}

// Serves the Stockfish engine files (src/engine.ts) at /stockfish/, straight from the npm package
// `stockfish`, so they're always the installed version. Only files named like its engines, and
// with the content types the browser needs to run them.
function stockfishFiles(): Plugin {
  const dir = fileURLToPath(new URL('./node_modules/stockfish/bin/', import.meta.url));
  return {
    name: 'stockfish-files',
    configureServer(server) {
      server.middlewares.use('/stockfish/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!/^stockfish-[\w.-]+\.(js|wasm)$/.test(name) || !existsSync(dir + name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(dir + name));
      });
    },
  };
}

export default defineConfig({ plugins: [dataApi(), stockfishFiles()] });
