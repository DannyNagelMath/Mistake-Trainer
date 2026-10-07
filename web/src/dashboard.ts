// dashboard.ts: Not in lila. The dashboard page (dashboard.html): your settings, and your
// suspended cards. DashboardCtrl keeps the page's state, and dashboardView.ts draws it with
// snabbdom, the way main.ts, deckCtrl.ts, and view.ts run the trainer.
// The settings are saved in data/settings.json (settings.ts); the trainer reads them when it
// loads, so going back to it after saving uses them.

import './mistakeTrainer.css';
import { init, attributesModule, classModule, eventListenersModule, propsModule } from 'snabbdom';

import { view } from './dashboardView';
import { loadDeck, type Deck } from './deck';
import { loadHistory, saveUnsuspension, type ReviewHistory } from './reviews';
import { defaultSettings, loadSettings, problems, saveSettings, type Settings } from './settings';

export class DashboardCtrl {
  saved: Settings; // what's in data/settings.json, or the defaults
  filledIn: Settings; // what the form was last filled in with
  draft: Settings; // what the form says now, which may be wrong (see problems)
  formVersion = 0; // raised to fill the form in again: a new key makes snabbdom make new inputs
  message = ''; // after saving

  constructor(
    readonly deck: Deck | undefined, // undefined before you've built one
    readonly history: ReviewHistory,
    settings: Settings,
    private readonly redraw: () => void,
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
      this.message = 'Saved. The trainer uses them from the next time it loads.';
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

  // The card can come up again. Suspending didn't touch its schedule: if it fell due while it
  // was suspended, it's due now, and if you never reviewed it, it's a new card again.
  unsuspend = async (cardId: string): Promise<void> => {
    try {
      await saveUnsuspension(cardId);
      delete this.history.suspended![cardId];
    } catch (e) {
      alert((e as Error).message);
    }
    this.redraw();
  };
}

const element = document.querySelector('main.mt-dashboard') as HTMLElement;

const [deck, history, settings] = await Promise.all([loadDeck(), loadHistory(), loadSettings()]).catch(
  (e: Error) => {
    element.textContent = e.message;
    throw e;
  },
);

// As in main.ts: render into the page's <main>, then re-render the whole view on every redraw.
const patch = init([classModule, attributesModule, propsModule, eventListenersModule]);
const ctrl = new DashboardCtrl(deck, history, settings, redraw);
let vnode = patch(element, view(ctrl));

function redraw(): void {
  vnode = patch(vnode, view(ctrl));
}
