// settingsPage.ts: Not in lila. Training settings: your settings, your suspended cards, and the
// computer analysis of your games (yourGames.ts).
// SettingsPageCtrl keeps its state, and settingsPageView.ts draws it with snabbdom. It shows in
// the trainer's page, over the trainer, which waits hidden as you left it (main.ts makes a new
// SettingsPageCtrl each time it opens).
// The settings are saved in data/settings.json (settings.ts), and passed on to the trainer, which
// uses them from then on (DeckCtrl.useSettings).

import type { Deck } from './deck';
import { saveUnsuspension, type ReviewHistory } from './reviews';
import { defaultSettings, problems, saveSettings, type Settings } from './settings';
import type { YourGamesCtrl } from './yourGames';

export class SettingsPageCtrl {
  saved: Settings; // what's in data/settings.json, or the defaults
  filledIn: Settings; // what the form was last filled in with
  draft: Settings; // what the form says now, which may be wrong (see problems)
  formVersion = 0; // raised to fill the form in again: a new key makes snabbdom make new inputs
  message = ''; // after saving
  looking?: string; // the suspended card you clicked, shown up close (settingsPageView.ts renderLook)

  constructor(
    readonly deck: Deck,
    readonly history: ReviewHistory, // the trainer's, so a card you unsuspend can come up at once
    settings: Settings,
    private readonly redraw: () => void,
    private readonly onSave: (settings: Settings) => void, // the trainer takes them up
    readonly yourGames: YourGamesCtrl, // the trainer's, so a run goes on after Training settings closes
  ) {
    this.saved = this.filledIn = this.draft = settings;
  }

  // On every change in the form.
  update = (draft: Settings): void => {
    this.draft = draft;
    this.message = '';
    this.redraw();
  };

  changed = (): boolean => (Object.keys(this.saved) as (keyof Settings)[]).some(k => this.draft[k] !== this.saved[k]);

  canSave = (): boolean => this.changed() && Object.keys(problems(this.draft)).length === 0;

  save = async (): Promise<void> => {
    if (!this.canSave()) return;
    const settings = this.draft;
    try {
      await saveSettings(settings);
      this.saved = settings;
      this.onSave(settings);
      this.message = 'Saved.';
    } catch (e) {
      this.message = (e as Error).message;
    }
    this.redraw();
  };

  // Fills the form in with the defaults. Nothing changes until you save.
  resetToDefaults = (): void => {
    this.draft = this.filledIn = defaultSettings;
    this.formVersion++;
    this.message = '';
    this.redraw();
  };

  // Shows a suspended card up close, or closes it (undefined).
  look = (cardId: string | undefined): void => {
    this.looking = cardId;
    this.redraw();
  };

  // The card can come up again. Suspending didn't touch its schedule: if it fell due while it
  // was suspended, it's due now, and if you never reviewed it, it's a new card again.
  unsuspend = async (cardId: string): Promise<void> => {
    try {
      await saveUnsuspension(cardId);
      delete this.history.suspended![cardId];
      if (this.looking === cardId) this.looking = undefined; // it's no longer one to look at
    } catch (e) {
      alert((e as Error).message);
    }
    this.redraw();
  };
}
