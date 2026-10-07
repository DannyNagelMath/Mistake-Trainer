// vite.config.ts: Vite's settings. Step 9: adds addresses to the dev server, so the pages can keep
// your data in files in data/ (gitignored), instead of in the browser:
//   GET  /api/reviews   returns your review history (an empty one if the file doesn't exist yet)
//   POST /api/reviews   with { card, entry } saves one review: the card's new schedule and its
//                       log entry; with { suspend, at } suspends the card with that id, and with
//                       { unsuspend } brings it back (see reviews.ts)
//   GET  /api/settings  returns the dashboard's settings ({} if you haven't saved any yet)
//   POST /api/settings  replaces them (see settings.ts, which checks them when a page loads them)
// They only exist in the dev server (npm run dev), which is how this app runs.
// To start your review history again, delete data/reviews.json; to go back to the default
// settings, delete data/settings.json. To use other files, e.g. for testing, set the
// REVIEWS_FILE and SETTINGS_FILE environment variables to their paths.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
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

export default defineConfig({ plugins: [dataApi()] });
