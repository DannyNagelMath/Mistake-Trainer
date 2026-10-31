// backup.ts: Not in lila. Export and Import: everything the app keeps (storage.ts), in one file, and
// back. On the website, that file is the only copy outside the browser.

import { parseSettings } from './settings';
import {
  inBrowser,
  loadAnalyses,
  loadDeck,
  loadGames,
  loadHistory,
  loadMasters,
  loadSettings,
  replaceAll,
  type AllData,
} from './storage';

const APP = 'Mistake Trainer';

// An export: everything, with what made it, and when.
export interface Backup extends AllData {
  app: typeof APP;
  version: 1;
  exportedAt: string; // an ISO date
}

export async function collectBackup(): Promise<Backup> {
  const [reviews, settings, analyses, games, masters, deck] = await Promise.all([
    loadHistory(),
    loadSettings(),
    loadAnalyses(),
    loadGames(),
    loadMasters(),
    loadDeck(),
  ]);
  return { app: APP, version: 1, exportedAt: new Date().toISOString(), reviews, settings, analyses, games, masters, deck: deck ?? null };
}

// The exported file's name, with the date where you are (exportedAt is in UTC, which can already be
// tomorrow), e.g. "mistake-trainer-2026-10-30.json".
export const exportFileName = (at: Date): string =>
  `mistake-trainer-${[at.getFullYear(), at.getMonth() + 1, at.getDate()].map(n => String(n).padStart(2, '0')).join('-')}.json`;

// Export: everything, in a file the browser downloads.
export async function exportData(): Promise<void> {
  const backup = await collectBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(new Date(backup.exportedAt));
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // once the download has surely started
}

// What an exported file holds; an error if it isn't one.
export function readBackup(text: string): Backup {
  let data: Partial<Backup> | undefined;
  try {
    data = JSON.parse(text);
  } catch {} // not JSON: said below
  const isBackup =
    data?.app === APP &&
    data.version === 1 &&
    typeof data.reviews?.cards === 'object' &&
    Array.isArray(data.reviews.log) &&
    typeof data.settings === 'object' &&
    typeof data.analyses === 'object' &&
    Array.isArray(data.games) &&
    typeof data.masters === 'object';
  if (!isBackup) throw new Error("That file isn't one that Mistake Trainer exported.");
  return data as Backup;
}

// e.g. "1 game", "1,282 games".
const count = (n: number, noun: string): string => `${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;

// Import: you choose a file, and once you say yes, everything here is replaced with what it holds,
// and the page loads again with it.
export function importData(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = readBackup(await file.text());
      const exported = new Date(backup.exportedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      const replace = confirm(
        `Replace everything here with ${file.name}, exported ${exported}: ${count(backup.reviews.log.length, 'review')} ` +
          `and ${count(backup.games.length, 'game')}? ` +
          (inBrowser ? 'What’s here now will be gone.' : 'What’s here now is first copied to data/backups.'),
      );
      if (!replace) return;
      const { reviews, settings, analyses, games, masters, deck } = backup;
      await replaceAll({ reviews, settings: parseSettings(settings), analyses, games, masters, deck: deck ?? null });
      location.reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };
  input.click();
}
