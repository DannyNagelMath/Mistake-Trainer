// vite.config.ts: Vite's settings. Step 9: adds two addresses to the dev server, so the page can
// keep your review history in a file, data/reviews.json (gitignored), instead of in the browser:
//   GET  /api/reviews  returns the history (an empty one if the file doesn't exist yet)
//   POST /api/reviews  with { card, entry } saves one review: the card's new schedule and its log entry
// They only exist in the dev server (npm run dev), which is how this app runs.
// To start your review history again, delete data/reviews.json. To use another file, e.g. for
// testing, set the REVIEWS_FILE environment variable to its path.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

import type { ReviewEntry, ReviewHistory } from './src/reviews.ts';

const historyFile = process.env.REVIEWS_FILE ?? fileURLToPath(new URL('./data/reviews.json', import.meta.url));

function readHistory(): ReviewHistory {
  return existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : { cards: {}, log: [] };
}

// Writes a temporary file, then renames it over the old one, so that a crash halfway through
// can't leave a half-written history.
function writeHistory(history: ReviewHistory): void {
  mkdirSync(dirname(historyFile), { recursive: true });
  writeFileSync(historyFile + '.tmp', JSON.stringify(history, null, 1));
  renameSync(historyFile + '.tmp', historyFile);
}

// A Vite plugin: configureServer runs when the dev server starts, and middlewares.use adds a
// handler for requests to /api/reviews. The file is read and written with the synchronous
// functions, so two saves can't interleave.
function reviewsApi(): Plugin {
  return {
    name: 'reviews-api',
    configureServer(server) {
      server.middlewares.use('/api/reviews', (req, res) => {
        const reply = (status: number, body: string, type = 'text/plain') => {
          res.statusCode = status;
          res.setHeader('Content-Type', type);
          res.end(body);
        };
        if (req.method === 'GET') {
          try {
            return reply(200, JSON.stringify(readHistory()), 'application/json');
          } catch (e) {
            return reply(500, String(e));
          }
        }
        if (req.method !== 'POST') return reply(405, 'Only GET and POST');
        let body = ''; // a request's body arrives in pieces
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
          try {
            const { card, entry } = JSON.parse(body) as { card: ReviewHistory['cards'][string]; entry: ReviewEntry };
            if (!card || typeof entry?.cardId !== 'string') return reply(400, 'Expected { card, entry }');
            const history = readHistory();
            history.cards[entry.cardId] = card;
            history.log.push(entry);
            writeHistory(history);
            reply(204, '');
          } catch (e) {
            reply(500, String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [reviewsApi()] });
