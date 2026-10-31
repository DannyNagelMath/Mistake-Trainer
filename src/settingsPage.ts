// settingsPage.ts: Not in lila. Training settings: your settings, updating your deck (deckUpdate.ts),
// the computer analysis of your games (yourGames.ts), and your suspended cards.
// SettingsPageCtrl keeps its state, and settingsPageView.ts draws it with snabbdom. It shows in
// the trainer's page, over the trainer, which waits hidden as you left it (trainer.ts makes a new
// SettingsPageCtrl each time it opens).
// The settings are saved (storage.ts), and passed on to the trainer, which uses them from then on
// (DeckCtrl.useSettings).

import type { Deck } from './deck';
import type { DeckUpdateCtrl } from './deckUpdate';
import type { Speed } from './gameDownload';
import { signOut } from './lichessAuth';
import type { ReviewHistory } from './reviews';
import { defaultSettings, problems, type Settings } from './settings';
import { saveSettings, saveUnsuspension } from './storage';
import type { YourGamesCtrl } from './yourGames';

export class SettingsPageCtrl {
  saved: Settings; // what's saved, or the defaults
  filledIn: Settings; // what the form was last filled in with
  draft: Settings; // what the form says now, which may be wrong (see problems)
  formVersion = 0; // raised to fill the form in again: a new key makes snabbdom make new inputs
  message = ''; // after saving
  looking?: string; // the suspended card you clicked, shown up close (settingsPageView.ts renderLook)
  // The kinds of games ticked beside "Update deck", outside the form: saved when you press it.
  gameTypes: Speed[];

  constructor(
    readonly deck: Deck,
    readonly history: ReviewHistory, // the trainer's, so a card you unsuspend can come up at once
    settings: Settings,
    private readonly redraw: () => void,
    private readonly onSave: (settings: Settings) => void, // the trainer takes them up
    readonly yourGames: YourGamesCtrl, // the trainer's, so a run goes on after Training settings closes
    readonly deckUpdate: DeckUpdateCtrl, // the same: an update goes on too
  ) {
    this.saved = this.filledIn = this.draft = settings;
    this.gameTypes = settings.gameTypes;
  }

  // On every change in the form, which has every setting but the kinds of games.
  update = (draft: Omit<Settings, 'gameTypes'>): void => {
    this.draft = { ...draft, gameTypes: this.saved.gameTypes };
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
    this.draft = this.filledIn = { ...defaultSettings, gameTypes: this.saved.gameTypes };
    this.formVersion++;
    this.message = '';
    this.redraw();
  };

  // The kinds of games ticked beside "Update deck".
  chooseGameTypes = (gameTypes: Speed[]): void => {
    this.gameTypes = gameTypes;
    this.redraw();
  };
  gameTypesChanged = (): boolean => JSON.stringify(this.gameTypes) !== JSON.stringify(this.saved.gameTypes);

  // "Update deck": first saves the kinds of games ticked, if they've changed, and passes them to the
  // trainer, whose update (deckUpdate.ts) downloads and builds with them. The rest of the form, if
  // it has changes, waits for its own Save.
  updateDeck = async (): Promise<void> => {
    if (!this.gameTypes.length || this.deckUpdate.state === 'running') return;
    if (this.gameTypesChanged()) {
      const settings = { ...this.saved, gameTypes: this.gameTypes };
      try {
        await saveSettings(settings);
      } catch (e) {
        this.message = (e as Error).message;
        return this.redraw();
      }
      this.saved = settings;
      this.draft = { ...this.draft, gameTypes: this.gameTypes };
      this.onSave(settings);
    }
    await this.deckUpdate.start();
  };

  // Signs out of Lichess (lichessAuth.ts), and shows it.
  signOut = async (): Promise<void> => {
    await signOut();
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
