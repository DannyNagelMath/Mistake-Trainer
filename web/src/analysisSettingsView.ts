// analysisSettingsView.ts: the analysis board's Settings dialog, which "Settings" in the ☰ menu
// opens. From lila's ui/analyse/src/view/settingsView.ts, in lila's dialog (snabDialog in
// ui/lib/src/view/dialog.ts) (master, commit 27ffc8b): the same elements and classes, so lila's
// CSS lays it out. Every change from lila's version is marked with a comment starting "Trim:".
// Trim: lila builds the dialog from HTML strings with its dialog helper; this is snabbdom, like
// the rest of the page, and AnalysisCtrl.settingsOpen says whether it shows.

import type { VNode } from 'snabbdom';

import type { AnalysisCtrl } from './analysisCtrl';
import type { SettingKey } from './analysisSettings';
import { i18n } from './i18n';
import { licon } from './licon';
import { hl, onInsert } from './snabbdom';

interface Setting {
  label: string;
  group: string;
  shortcut?: string[]; // its keyboard shortcuts, e.g. ['shift+i'] (see keys below)
  video?: string; // lila's short video of what it does, in public/lila/video (buildLilaCss.ts)
  note?: (VNode | string)[]; // a line under the video
}

// Trim: lila has more settings (see analysisSettings.ts). Its help for the gauge is a picture,
// which COPYING.md lists as non-free, so that one has none here.
const settings: Record<SettingKey, Setting> = {
  showStaticAnalysis: {
    label: i18n.preferences.showMainlineAnalysis,
    shortcut: ['z'],
    group: i18n.preferences.generalSettings,
    video: 'info-static-analysis',
  },
  showGauge: {
    label: i18n.preferences.showGauge,
    group: i18n.preferences.generalSettings,
  },
  inline: {
    label: i18n.preferences.inlineNotation,
    shortcut: ['shift+i'],
    group: i18n.preferences.moveListSettings,
    video: 'info-inline-notation',
  },
  disclosureMode: {
    label: i18n.preferences.disclosureMode,
    group: i18n.preferences.moveListSettings,
    video: 'info-disclosure-mode',
  },
  showBestMoveArrows: {
    label: i18n.preferences.showBestMoveArrows,
    shortcut: ['a'],
    group: i18n.preferences.boardSettings,
    video: 'info-best-move-arrows',
  },
  showVariationArrows: {
    label: i18n.preferences.showVariationArrows,
    shortcut: ['v'],
    group: i18n.preferences.boardSettings,
    video: 'info-variation-arrows',
    note: [i18n.site.keyCycleSelectedVariation, ' ', hl('kbd', 'shift')],
  },
  showMoveAnnotationsOnBoard: {
    label: i18n.preferences.showMoveAnnotationsOnBoard,
    group: i18n.preferences.boardSettings,
    video: 'info-move-annotations-on-board',
  },
  showUndefendedPieces: {
    label: i18n.preferences.showUndefendedPieces,
    group: i18n.preferences.boardSettings,
    video: 'info-undefended-pieces',
  },
  showPinnedPieces: {
    label: i18n.preferences.showPinnedPieces,
    group: i18n.preferences.boardSettings,
    video: 'info-pinned-pieces',
  },
  showCheckableKing: {
    label: i18n.preferences.showCheckableKing,
    group: i18n.preferences.boardSettings,
    video: 'info-checkable-king',
  },
};

// lila's hover help (setupHoverHelp): pointing at a setting shows its video where the keyboard
// shortcuts are; leaving it brings them back after 300 ms, unless you've pointed at another.
// Trim: lila preloads each video before showing it, and on touch screens shows them in a popup.
let pointedAt: SettingKey | undefined;
let resetTimeout: ReturnType<typeof setTimeout> | undefined;
function pointAt(ctrl: AnalysisCtrl, key: SettingKey | undefined): void {
  clearTimeout(resetTimeout);
  if (key) {
    pointedAt = key;
    ctrl.redraw();
  } else
    resetTimeout = setTimeout(() => {
      pointedAt = undefined;
      ctrl.redraw();
    }, 300);
}

// lila's flexTamer: once the dialog is open, its size stays as its first contents made it, so
// that a shorter video doesn't shrink it and move the settings away from under the pointer.
// Trim: lila sizes it again when the window is resized, and not at all on touch screens.
function freezeSize(dialog: HTMLElement): void {
  const content = dialog.querySelector<HTMLElement>('.analysis-settings-dialog');
  if (!content) return;
  const { width, height } = content.getBoundingClientRect();
  content.style.width = `${width}px`;
  content.style.height = `${height}px`;
}

// Like lila's dialog with easyClose 'clickOutside': a click outside the dialog closes it. With
// the dialog open (showModal), a click on the dimmed page around it lands on the dialog itself.
// Also used by Training settings' closer look at a suspended card (settingsPageView.ts).
export function clickedOutside(e: MouseEvent): boolean {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

export function view(ctrl: AnalysisCtrl): VNode {
  const close = (e: Event) => (e.currentTarget as HTMLElement).closest('dialog')!.close();
  return hl(
    'dialog',
    {
      hook: onInsert<HTMLDialogElement>(el => {
        pointedAt = undefined;
        el.showModal();
        freezeSize(el);
      }),
      on: {
        close: ctrl.closeSettings, // also after Escape, which closes an open dialog by itself
        click: e => clickedOutside(e) && close(e),
      },
    },
    [
      hl(
        'div.close-button-anchor',
        hl('button.close-button', {
          attrs: { 'data-icon': licon.X, 'aria-label': i18n.site.close },
          on: { click: close },
        }),
      ),
      hl(
        'div.scrollable',
        hl('div.dialog-content.analysis-settings-dialog', [hl('h2', 'Analysis settings'), settingsView(ctrl)]),
      ),
    ],
  );
}

function settingsView(ctrl: AnalysisCtrl): VNode {
  const grouped = (group: string) =>
    hl('fieldset', [
      hl('legend', group),
      (Object.keys(settings) as SettingKey[]).filter(key => settings[key].group === group).map(key => toggle(ctrl, key)),
    ]);
  return hl('div.analysis-settings-view', [
    hl('div.column', [helpView(), grouped(i18n.preferences.generalSettings)]),
    hl('div.column', [grouped(i18n.preferences.moveListSettings), grouped(i18n.preferences.boardSettings)]),
  ]);
}

// lila's defaultToggleHtml and defaultToggleListener: a label, and lila's on/off switch, which is
// a checkbox styled by its CSS.
function toggle(ctrl: AnalysisCtrl, key: SettingKey): VNode {
  const video = settings[key].video;
  return hl(
    'span.setting',
    {
      class: { 'hover-help': !!video },
      attrs: { 'data-key': key },
      on: video ? { mouseenter: () => pointAt(ctrl, key), mouseleave: () => pointAt(ctrl, undefined) } : {},
    },
    [
      hl('span', settings[key].label),
      hl('span.form-check__input', [
        hl('input', {
          attrs: { 'data-key': key, id: key, type: 'checkbox' },
          props: { checked: ctrl.settings[key] },
          on: { change: e => ctrl.settings.set(key, (e.target as HTMLInputElement).checked) },
        }),
        hl('label.form-check__label', { attrs: { for: key } }),
      ]),
    ],
  );
}

// Keyboard shortcuts, each a key or keys pressed together, e.g. ['shift+i'] or ['←', '→'],
// written as lila writes them: <kbd>shift</kbd> +<kbd>i</kbd>.
const keys = (shortcuts: string[]): (VNode | string)[] =>
  shortcuts.flatMap((combo, i) => [
    ...(i > 0 ? [' '] : []),
    ...combo.split('+').flatMap((key, j) => (j > 0 ? [' +', hl('kbd', key)] : [hl('kbd', key)])),
  ]);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// lila's helpHtml: the keyboard shortcuts, or the video of the setting you're pointing at.
// Trim: lila has a "More" button for its full list of shortcuts. Not in lila: instead, ours are
// all here.
function helpView(): VNode {
  const shortcut = (label: string, shortcuts: string[]) => hl('div.setting.inert', [label, hl('span', keys(shortcuts))]);
  const video = pointedAt && settings[pointedAt].video;
  if (pointedAt && video)
    return hl(
      'div.help-container',
      hl('fieldset.help-pane', { key: pointedAt, attrs: { 'data-key': pointedAt } }, [
        hl('legend', settings[pointedAt].label),
        hl(
          'video',
          {
            attrs: { autoplay: true, loop: true, muted: true, playsinline: true, preload: 'auto' },
            props: { muted: true }, // the browser only plays it by itself if it's silent
            hook: onInsert<HTMLVideoElement>(el => el.play().catch(() => {})),
          },
          hl('source', { attrs: { src: `/lila/video/${video}.webm`, type: 'video/webm' } }),
        ),
        hl('br'),
        settings[pointedAt].note && hl('span', settings[pointedAt].note),
      ]),
    );
  return hl(
    'div.help-container',
    hl('fieldset.help-pane', { key: 'keyboardShortcuts', attrs: { 'data-key': 'keyboardShortcuts' } }, [
      hl('legend', i18n.site.keyboardShortcuts),
      shortcut(i18n.site.flipBoard, ['f']),
      shortcut(i18n.site.toggleLocalEngine, ['l']),
      (Object.keys(settings) as SettingKey[]).map(
        key => settings[key].shortcut && shortcut(settings[key].label, settings[key].shortcut!),
      ),
      shortcut(capitalize(i18n.site.keyMoveBackwardOrForward), ['←', '→']),
      shortcut(capitalize(i18n.site.keyGoToStartOrEnd), ['↑', '↓']),
      shortcut(i18n.site.keyPreviousBranch, ['shift+←']),
      shortcut(i18n.site.keyNextBranch, ['shift+→']),
      shortcut(i18n.site.keyCycleSelectedVariation, ['shift']),
      shortcut(capitalize(i18n.site.keyShowOrHideComments), ['shift+c']),
      shortcut(i18n.site.menu, ['h']),
    ]),
  );
}
