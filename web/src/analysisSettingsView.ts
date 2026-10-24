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
}

// Trim: lila's settings also have help videos, which play when you point at a setting, and lila
// has more settings (see analysisSettings.ts).
const settings: Record<SettingKey, Setting> = {
  showStaticAnalysis: {
    label: i18n.preferences.showServerAnalysis,
    shortcut: ['z'],
    group: i18n.preferences.generalSettings,
  },
  inline: {
    label: i18n.preferences.inlineNotation,
    shortcut: ['shift+i'],
    group: i18n.preferences.moveListSettings,
  },
  showMoveAnnotationsOnBoard: {
    label: i18n.preferences.showMoveAnnotationsOnBoard,
    group: i18n.preferences.boardSettings,
  },
};

// Like lila's dialog with easyClose 'clickOutside': a click outside the dialog closes it. With
// the dialog open (showModal), a click on the dimmed page around it lands on the dialog itself.
function clickedOutside(e: MouseEvent): boolean {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

export function view(ctrl: AnalysisCtrl): VNode {
  const close = (e: Event) => (e.currentTarget as HTMLElement).closest('dialog')!.close();
  return hl(
    'dialog',
    {
      hook: onInsert<HTMLDialogElement>(el => el.showModal()),
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
  return hl('span.setting', { attrs: { 'data-key': key } }, [
    hl('span', settings[key].label),
    hl('span.form-check__input', [
      hl('input', {
        attrs: { 'data-key': key, id: key, type: 'checkbox' },
        props: { checked: ctrl.settings[key] },
        on: { change: e => ctrl.settings.set(key, (e.target as HTMLInputElement).checked) },
      }),
      hl('label.form-check__label', { attrs: { for: key } }),
    ]),
  ]);
}

// Keyboard shortcuts, each a key or keys pressed together, e.g. ['shift+i'] or ['←', '→'],
// written as lila writes them: <kbd>shift</kbd> +<kbd>i</kbd>.
const keys = (shortcuts: string[]): (VNode | string)[] =>
  shortcuts.flatMap((combo, i) => [
    ...(i > 0 ? [' '] : []),
    ...combo.split('+').flatMap((key, j) => (j > 0 ? [' +', hl('kbd', key)] : [hl('kbd', key)])),
  ]);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// lila's helpHtml: the keyboard shortcuts.
// Trim: lila lists "Toggle local engine" (l), as we have no engine display, and has a "More"
// button for its full list of shortcuts. Not in lila: instead, ours are all here.
function helpView(): VNode {
  const shortcut = (label: string, shortcuts: string[]) => hl('div.setting.inert', [label, hl('span', keys(shortcuts))]);
  return hl(
    'div.help-container',
    hl('fieldset.help-pane', { attrs: { 'data-key': 'keyboardShortcuts' } }, [
      hl('legend', i18n.site.keyboardShortcuts),
      shortcut(i18n.site.flipBoard, ['f']),
      (Object.keys(settings) as SettingKey[]).map(
        key => settings[key].shortcut && shortcut(settings[key].label, settings[key].shortcut!),
      ),
      shortcut(capitalize(i18n.site.keyMoveBackwardOrForward), ['←', '→']),
      shortcut(capitalize(i18n.site.keyGoToStartOrEnd), ['↑', '↓']),
      shortcut(i18n.site.keyPreviousBranch, ['shift+←']),
      shortcut(i18n.site.keyNextBranch, ['shift+→']),
      shortcut(capitalize(i18n.site.keyShowOrHideComments), ['shift+c']),
      shortcut(i18n.site.menu, ['h']),
    ]),
  );
}
