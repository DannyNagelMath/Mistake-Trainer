// progressView.test.ts: how the progress box says when the next cards come up. Dates and times are
// written the way the computer's settings say (toLocaleDateString, toLocaleTimeString), so the
// test writes them the same way.
import { expect, test } from 'vitest';

import { describeNext } from './progressView';

const now = new Date(2026, 9, 28, 14, 0); // Wednesday, Oct 28, 2026, at 2 PM, local time
const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).getTime();
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('the next cards: how many that day, and the time the first of them comes up', () => {
  const friday = at(30, 15, 57); // the day after tomorrow
  const date = new Date(friday).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  expect(describeNext({ at: friday, count: 45 }, now)).toBe(`Next: 45 on ${date}, from ${time(friday)}`);
});

test('today and tomorrow are said so, and a single card comes up at its time, not from it', () => {
  expect(describeNext({ at: at(28, 19, 12), count: 3 }, now)).toBe(`Next: 3 today, from ${time(at(28, 19, 12))}`);
  expect(describeNext({ at: at(29, 9, 5), count: 1 }, now)).toBe(`Next: 1 tomorrow, at ${time(at(29, 9, 5))}`);
  // across the end of a month: tomorrow, then the day after
  const halloween = new Date(2026, 9, 31, 12, 0);
  expect(describeNext({ at: new Date(2026, 10, 1, 8, 0).getTime(), count: 2 }, halloween)).toContain('tomorrow');
  expect(describeNext({ at: new Date(2026, 10, 2, 8, 0).getTime(), count: 2 }, halloween)).toContain('on ');
});
