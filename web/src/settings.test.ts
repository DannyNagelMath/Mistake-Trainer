// settings.test.ts: checks how settings.ts reads data/settings.json, and what it says is wrong
// with a setting.
import { expect, test } from 'vitest';

import { defaultSettings, fixProblems, parseSettings, problems, type Settings } from './settings';

const with_ = (more: Partial<Settings>): Settings => ({ ...defaultSettings, ...more });

test('with no file, or nothing useful in it, everything is at its default', () => {
  expect(parseSettings({})).toEqual(defaultSettings);
  expect(parseSettings(null)).toEqual(defaultSettings);
  expect(parseSettings('nonsense')).toEqual(defaultSettings);
});

test('saved settings are kept, missing ones are the defaults, and unknown ones are dropped', () => {
  const s = parseSettings({ minGapDays: 3, newCardOrder: 'recent', newCardsPerDay: 20, colour: 'blue' });
  expect(s).toEqual(with_({ minGapDays: 3, newCardOrder: 'recent', newCardsPerDay: 20 }));
  expect(parseSettings({ newCardsPerDay: null }).newCardsPerDay).toBeNull(); // no limit
});

test('a wrong setting goes back to its default, and only that one', () => {
  const s = parseSettings({ minGapDays: -1, masteredDays: 45, newCardOrder: 'alphabetical', desiredRetention: 1 });
  expect(s).toEqual(with_({ masteredDays: 45 }));
});

test('if either eval of a collapse is wrong, both go back to their defaults', () => {
  // -3 before is fine alone, but the default -2 after it isn't below it
  expect(parseSettings({ collapseBefore: -3, collapseAfter: 'x' })).toEqual(defaultSettings);
  expect(parseSettings({ collapseBefore: 1, collapseAfter: -1 })).toEqual(with_({ collapseBefore: 1, collapseAfter: -1 }));
});

test('problems: numbers out of range, not whole, or not numbers', () => {
  expect(problems(defaultSettings)).toEqual({});
  expect(problems(with_({ minGapDays: 91 }))).toEqual({ minGapDays: 'A whole number from 0 to 90' });
  expect(problems(with_({ masteredDays: 30.5 }))).toEqual({ masteredDays: 'A whole number from 1 to 3650' });
  expect(problems(with_({ desiredRetention: NaN }))).toEqual({ desiredRetention: 'A number from 0.7 to 0.97' });
  expect(problems(with_({ newCardsPerDay: 0 }))).toEqual({ newCardsPerDay: 'A whole number from 1 to 1000' });
  expect(problems(with_({ newCardsPerDay: null }))).toEqual({});
});

test('problems: a collapse must end lower than it starts', () => {
  expect(problems(with_({ collapseBefore: -2, collapseAfter: -2 }))).toEqual({
    collapseAfter: 'Must be below the eval before the move',
  });
});

test('fixProblems keeps what makes sense and takes the rest from the fallback', () => {
  const saved = with_({ minGapDays: 5, collapseAfter: -3 });
  const draft = with_({ minGapDays: 100, collapseBefore: -4, openingMoves: 15 }); // -4 isn't above the -2 after it
  expect(fixProblems(draft, saved)).toEqual(with_({ minGapDays: 5, collapseAfter: -3, openingMoves: 15 }));
});
