// analysisSettings.ts: the analysis board's own settings, which "Settings" in the ☰ menu changes
// (analysisSettingsView.ts): what the move list and the board show. Not your training settings
// (settings.ts). From lila's ui/analyse/src/settingsCtrl.ts (master, commit 27ffc8b); every
// change from lila's version is marked with a comment starting "Trim:".
// Like lila, the browser remembers them (localStorage), for this address: a dev server on another
// port starts again from the defaults.

// lila's defaults, in lila's order.
// Trim: lila also has showLiveAnnotations and showManeuverMoveArrows, for things we don't have.
export class AnalysisSettings {
  constructor(
    public readonly showGauge = true, // the evaluation bar beside the board
    public readonly inline = false, // the move list as a paragraph, rather than in two columns
    public readonly showStaticAnalysis = true, // the computer analysis: evals, ?? marks, comments, engine lines
    public readonly disclosureMode = false, // buttons in the move list to fold variations away
    public readonly showBestMoveArrows = true, // the better move instead, and the best move from here
    public readonly showVariationArrows = true, // an arrow for each continuation, where there's a choice
    public readonly showMoveAnnotationsOnBoard = true, // the move's ?? or ?! on its square
    public readonly showUndefendedPieces = false, // marks on pieces the other side can win (motif.ts)
    public readonly showPinnedPieces = false, // marks on pinned pieces
    public readonly showCheckableKing = false, // a mark on a king that can be checked
  ) {}
}

const defaultSettings = Object.freeze(new AnalysisSettings());

export type SettingKey = keyof AnalysisSettings;

export class AnalysisSettingsCtrl extends AnalysisSettings {
  // Trim: lila adds the user's id to the key, and saves at most once a second (throttle).
  private readonly key = 'analyse.settings';

  constructor(public readonly redraw?: () => void) {
    super();
    // Not in lila: reading can fail where there's no storage (the tests) or it's blocked; then
    // the defaults stand.
    try {
      const local = localStorage.getItem(this.key);
      if (local) Object.assign(this, JSON.parse(local));
    } catch {
      try {
        localStorage.removeItem(this.key);
      } catch {}
    }
  }

  keys(): SettingKey[] {
    return Object.keys(defaultSettings) as SettingKey[];
  }

  set<K extends SettingKey>(key: K, value: AnalysisSettings[K]) {
    const oldValue = this[key];
    if (oldValue === value) return;
    this[key] = value;
    this.redraw?.();
    this.save();
  }

  save() {
    const local = Object.fromEntries(this.keys().map(k => [k, this[k]]));
    try {
      localStorage.setItem(this.key, JSON.stringify(local));
    } catch {} // Not in lila: no storage, so the setting lasts until the page is reloaded
  }
}
