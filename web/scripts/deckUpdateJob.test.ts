// deckUpdateJob.test.ts: checks the dev server's side of "Update deck" (deckUpdateJob.ts): it runs a
// program in the background, keeps what it prints, and says how it ended. Small node programs stand
// in for updateDeck.ts.
import { expect, test } from 'vitest';

import { DeckUpdateJob } from './deckUpdateJob';

const job = (program: string) => new DeckUpdateJob(process.execPath, ['-e', program], process.cwd());

// Waits until the job has ended.
async function ended(j: DeckUpdateJob): Promise<void> {
  for (let i = 0; i < 200 && j.status.state === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 25));
}

test('it runs in the background, keeping what it prints, line by line, and says when it is done', async () => {
  const j = job(
    "console.log('Downloading your new games...'); process.stdout.write('Added 3 '); setTimeout(() => console.log('new games.'), 50)",
  );
  expect(j.status).toEqual({ state: 'idle', lines: [] });
  j.start();
  expect(j.status.state).toBe('running');
  await ended(j);
  expect(j.status).toMatchObject({ state: 'done', lines: ['Downloading your new games...', 'Added 3 new games.'] });
  expect(j.status.endedAt! >= j.status.startedAt!).toBe(true);
});

test('one at a time: starting it while it runs changes nothing, and once it has ended, it can run again', async () => {
  const j = job("setTimeout(() => console.log('built'), 200)");
  j.start();
  const running = j.status;
  j.start();
  expect(j.status).toBe(running);
  await ended(j);
  expect(j.status.lines).toEqual(['built']); // once
  j.start();
  expect(j.status).not.toBe(running);
  expect(j.status.state).toBe('running');
  await ended(j);
});

test('if it fails, it says so, keeping what it printed, errors too', async () => {
  const j = job("console.log('Building the deck...'); console.error('Error: no token'); process.exit(1)");
  j.start();
  await ended(j);
  expect(j.status.state).toBe('failed');
  expect(j.status.lines).toEqual(expect.arrayContaining(['Building the deck...', 'Error: no token']));
});

test("if it can't start at all, it says why", async () => {
  const j = new DeckUpdateJob('no-such-program-anywhere', [], process.cwd());
  j.start();
  await ended(j);
  expect(j.status.state).toBe('failed');
  expect(j.status.lines.join(' ')).toContain('ENOENT');
});

test('Python, which runs the download, is told to print as it goes', async () => {
  const j = job('console.log(process.env.PYTHONUNBUFFERED)');
  j.start();
  await ended(j);
  expect(j.status.lines).toEqual(['1']);
});

test('only the latest 200 lines are kept', async () => {
  const j = job("for (let i = 1; i <= 250; i++) console.log('line ' + i)");
  j.start();
  await ended(j);
  expect(j.status.lines).toHaveLength(200);
  expect([j.status.lines[0], j.status.lines.at(-1)]).toEqual(['line 51', 'line 250']);
});
