// setupView.test.ts: checks the first-run screen's choices (firstRunChoices): the kinds of games and
// "Recent games", which the screen saves as you make them, so that signing in doesn't lose them.
import { expect, test } from 'vitest';

import { defaultSettings } from './settings';
import { firstRunChoices } from './setupView';

test('your choices, as settings: the kinds of games, and Recent games, empty for all', () => {
  expect(firstRunChoices(defaultSettings, ['bullet', 'blitz'], '50')).toEqual({
    settings: { ...defaultSettings, gameTypes: ['bullet', 'blitz'], recentGames: 50 },
  });
  expect(firstRunChoices(defaultSettings, ['rapid'], ' ')).toEqual({
    settings: { ...defaultSettings, gameTypes: ['rapid'], recentGames: null },
  });
});

test("what's wrong, instead: no kind of game, or a Recent games that isn't a whole number from 1", () => {
  expect(firstRunChoices(defaultSettings, [], '20')).toEqual({ problem: 'Choose at least one kind of game.' });
  for (const wrong of ['0', '2.5', 'ten'])
    expect(firstRunChoices(defaultSettings, ['blitz'], wrong)).toEqual({
      problem: 'New cards from your last … games: a whole number from 1 to 100000, or empty for all.',
    });
});
