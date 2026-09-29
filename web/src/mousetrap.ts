// mousetrap.ts: keyboard shortcuts, copied from lila's ui/site/src/mousetrap.ts (master,
// commit 27ffc8b), where it's the global site.mousetrap. lila adapted it from Mousetrap, whose
// licence follows. The changes are marked "Trim:".
//
// Usage: new Mousetrap().bind(['left', 'k'], callback). A binding is a key name, optionally after
// modifiers ('shift+left'). Named keys are the values of KEY_MAP below; others are the character.

/**
 * Adapted from https://craig.is/killing/mice
 * Copyright 2012-2017 Craig Campbell
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Trim: lila imports isEquivalent from ui/lib/src/algo.ts, which compares any two values.
// It's only used on lists of modifier names here.
const isEquivalent = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

type Action = 'keypress' | 'keydown' | 'keyup';

type Callback = (e: KeyboardEvent) => void;

interface KeyInfo {
  key: string;
  modifiers: string[];
  action: Action;
}

interface Binding {
  combination: string;
  callback: Callback;
  modifiers: string[];
  action: Action;
}

const KEY_MAP: Record<string, string> = {
  Backspace: 'backspace',
  Tab: 'tab',
  Enter: 'enter',
  Shift: 'shift',
  Control: 'ctrl',
  Alt: 'alt',
  CapsLock: 'capslock',
  Escape: 'esc',
  ' ': 'space',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  End: 'end',
  Home: 'home',
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  Insert: 'ins',
  Delete: 'del',
  Meta: 'meta',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Digit0: '0',
};

const SPECIAL_KEYS: Set<string> = new Set(Object.values(KEY_MAP));
for (let i = 1; i < 20; ++i) SPECIAL_KEYS.add('f' + i);

const SPECIAL_ALIASES: Record<string, string> = {
  option: 'alt',
  command: 'meta',
  return: 'enter',
  escape: 'esc',
  plus: '+',
  mod: /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'meta' : 'ctrl',
};

const keyFromEvent = (e: KeyboardEvent): string => {
  if (e.type === 'keypress') {
    return e.shiftKey ? e.key : e.key?.toLowerCase();
  }
  return KEY_MAP[e.key] ?? KEY_MAP[e.code] ?? e.key?.toLowerCase();
};

const modifiersMatch = (a: string[], b: string[]): boolean => a.sort().join(',') === b.sort().join(',');

const eventModifiers = (e: KeyboardEvent): string[] => {
  const modifiers: string[] = [];
  if (e.shiftKey) modifiers.push('shift');
  if (e.altKey) modifiers.push('alt');
  if (e.ctrlKey) modifiers.push('ctrl');
  if (e.metaKey) modifiers.push('meta');
  return modifiers;
};

const isModifier = (key: string): boolean => key === 'shift' || key === 'ctrl' || key === 'alt' || key === 'meta';

// Named keys like 'left' are matched on keydown, and characters like '$' or '?' on keypress,
// which reports the character typed (so '$' matches shift+4 on a US keyboard).
const pickBestAction = (key: string, modifiers: string[], action?: Action): Action => {
  action = action || (SPECIAL_KEYS.has(key) ? 'keydown' : 'keypress');
  if (action === 'keypress' && modifiers.length) return 'keydown'; // modifiers incompatible with keypress
  return action;
};

const keysFromString = (combination: string): string[] =>
  combination === '+' ? ['+'] : combination.replace(/\+{2}/g, '+plus').split('+');

const getKeyInfo = (combination: string, action?: Action): KeyInfo => {
  let key: string;
  const modifiers: string[] = [];

  for (key of keysFromString(combination)) {
    key = SPECIAL_ALIASES[key] || key; // normalize
    if (isModifier(key)) modifiers.push(key);
  }

  return {
    key: key!,
    modifiers,
    action: pickBestAction(key!, modifiers, action),
  };
};

export default class Mousetrap {
  private readonly bindings: Record<string, Binding[]> = {};

  // Trim: lila's also accepts an HTMLElement. Our TypeScript then can't tell that the events will be
  // KeyboardEvents, and we only ever listen on the document.
  constructor(targetElement: Document = document) {
    targetElement.addEventListener('keypress', this.handleKeyEvent);
    targetElement.addEventListener('keydown', this.handleKeyEvent);
    targetElement.addEventListener('keyup', this.handleKeyEvent);
  }

  /**
   * Binds an event to mousetrap.
   *
   * Can be a single key, a combination of keys separated with +,
   * or an array of such combinations.
   *
   * When adding modifiers, list the actual key last.
   */
  bind = (combinations: string | string[], callback: Callback, action?: Action, multiple = true): Mousetrap => {
    for (const combo of Array.isArray(combinations) ? combinations : [combinations]) {
      const info = getKeyInfo(combo, action);
      this.bindings[info.key] ??= [];
      if (multiple || !this.bindings[info.key].some(b => isEquivalent(b.modifiers, info.modifiers)))
        this.bindings[info.key].push({
          combination: combo,
          callback,
          modifiers: info.modifiers,
          action: info.action,
        });
    }
    return this;
  };

  unbind = (key: string): void => {
    this.bindings[key]?.forEach((b, i) => {
      if (b.modifiers.length === 0) this.bindings[key].splice(i, 1);
    });
  };

  // Runs the matching bindings, unless you're typing in a text box.
  private readonly handleKeyEvent = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    for (const binding of this.getMatches(e)) {
      if (
        binding.combination === 'esc' ||
        (!['INPUT', 'SELECT', 'OPTION', 'TEXTAREA'].includes(el.tagName) &&
          !el.isContentEditable &&
          !el.hasAttribute('trap-bypass'))
      ) {
        binding.callback(e);
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };

  private readonly getMatches = (e: KeyboardEvent): Binding[] => {
    const key = keyFromEvent(e);
    const action = e.type;
    const modifiers = action === 'keyup' && isModifier(key) ? [key] : eventModifiers(e);
    return (this.bindings[key] || []).filter(
      binding =>
        action === binding.action &&
        // Chrome will not fire a keypress if meta or control is down,
        // Safari will fire a keypress if meta or meta+shift is down,
        // Firefox will fire a keypress if meta or control is down
        ((action === 'keypress' && !e.metaKey && !e.ctrlKey) || modifiersMatch(modifiers, binding.modifiers)),
    );
  };
}
