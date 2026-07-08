// Locks the pure helpers around the scheduler: date math, interval parsing, typed
// grading, and the deck schedule preview (dueDateForCycleDay / dueGroupsForDeckOnDay,
// which project the idealized fresh-start grid for a hypothetical cycle day).

import {
  addDays,
  bucketLetter,
  checkTypedAnswer,
  cycleDayOf,
  daysBetween,
  dueDateForCycleDay,
  dueGroupsForDeckOnDay,
  normalizeTypedInput,
  parseIntervalsList,
  todayInTz,
} from '@/lib/leitner';
import type { Card } from '@/types/domain';

const IV = [1, 2, 4]; // A, B, C

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    front: 'front',
    back: '',
    grading_mode: 'typed',
    typed_alternates: [],
    choices: [],
    ...overrides,
  };
}

describe('bucketLetter', () => {
  it('maps 0-indexed buckets to letters', () => {
    expect(bucketLetter(0)).toBe('A');
    expect(bucketLetter(1)).toBe('B');
    expect(bucketLetter(4)).toBe('E');
  });
});

describe('parseIntervalsList', () => {
  it('parses comma- or space-separated positive integers', () => {
    expect(parseIntervalsList('1, 2, 4, 8, 16')).toEqual([1, 2, 4, 8, 16]);
    expect(parseIntervalsList('1 3 7')).toEqual([1, 3, 7]);
  });

  it('rejects empty input', () => {
    expect(() => parseIntervalsList('   ')).toThrow(/at least one/i);
  });

  it('requires 2–10 intervals', () => {
    expect(() => parseIntervalsList('5')).toThrow(/2.*10/);
    expect(() => parseIntervalsList('1 2 3 4 5 6 7 8 9 10 11')).toThrow(/2.*10/);
  });

  it('rejects non-integers and non-positive values', () => {
    expect(() => parseIntervalsList('1, x, 3')).toThrow(/positive integer/i);
    expect(() => parseIntervalsList('1, 0, 3')).toThrow(/positive integer/i);
  });
});

describe('daysBetween / addDays', () => {
  it('counts whole days between ISO dates, signed', () => {
    expect(daysBetween('2026-07-08', '2026-07-10')).toBe(2);
    expect(daysBetween('2026-07-10', '2026-07-08')).toBe(-2);
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
  });

  it('adds/subtracts days across month and year boundaries', () => {
    expect(addDays('2026-07-08', 3)).toBe('2026-07-11');
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-07-08', -1)).toBe('2026-07-07');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('cycleDayOf', () => {
  it('null start ⇒ day 0 (fresh start)', () => {
    expect(cycleDayOf(null, '2026-07-08')).toBe(0);
  });
  it('counts days since the start date', () => {
    expect(cycleDayOf('2026-07-03', '2026-07-08')).toBe(5);
  });
  it('clamps a future start date to 0', () => {
    expect(cycleDayOf('2026-07-11', '2026-07-08')).toBe(0);
  });
});

describe('todayInTz', () => {
  it('resolves the calendar day in the given timezone', () => {
    const instant = new Date('2026-07-08T05:00:00Z');
    expect(todayInTz('UTC', instant)).toBe('2026-07-08');
    // 05:00Z is 22:00 the previous day in Los Angeles (UTC-7 in July).
    expect(todayInTz('America/Los_Angeles', instant)).toBe('2026-07-07');
  });
});

describe('normalizeTypedInput / checkTypedAnswer', () => {
  it('normalizes case, surrounding whitespace, and trailing punctuation', () => {
    expect(normalizeTypedInput('  Hello,  World!! ')).toBe('hello, world');
    expect(normalizeTypedInput('CAT')).toBe('cat');
  });

  it('accepts the exact back answer regardless of case/punctuation', () => {
    const card = makeCard({ back: 'Paris' });
    expect(checkTypedAnswer(card, 'paris')).toBe(true);
    expect(checkTypedAnswer(card, 'PARIS.')).toBe(true);
    expect(checkTypedAnswer(card, 'London')).toBe(false);
  });

  it('accepts any configured alternate', () => {
    const card = makeCard({ back: 'color', typed_alternates: ['colour'] });
    expect(checkTypedAnswer(card, 'colour')).toBe(true);
  });
});

// ─── Deck schedule preview ───────────────────────────────────────────────────

describe('dueDateForCycleDay', () => {
  const today = '2026-07-08';
  it('day 0: bucket A due today, higher buckets one interval out', () => {
    expect(dueDateForCycleDay(today, 0, 0, IV)).toBe(today);
    expect(dueDateForCycleDay(today, 0, 2, IV)).toBe(addDays(today, 4));
  });
  it('mid-cycle: soonest grid slot at or after the cycle day', () => {
    // Bucket C (interval 4) on cycle day 5 → next slot at day 8, i.e. 3 days out.
    expect(dueDateForCycleDay(today, 5, 2, IV)).toBe(addDays(today, 3));
  });
});

describe('dueGroupsForDeckOnDay', () => {
  const today = '2026-07-08';
  const states = [
    { bucket_index: 0, graduated_at: null },
    { bucket_index: 0, graduated_at: null },
    { bucket_index: 1, graduated_at: null },
    { bucket_index: 2, graduated_at: null },
    { bucket_index: 2, graduated_at: '2026-07-01T00:00:00Z' }, // graduated → excluded
  ];

  it('day 0: only bucket A is due; B and C are scheduled but not yet due', () => {
    expect(dueGroupsForDeckOnDay(states, IV, 0, today)).toEqual([
      { bucket: 0, due: 2, notDue: 0 },
      { bucket: 1, due: 0, notDue: 1 },
      { bucket: 2, due: 0, notDue: 1 },
    ]);
  });

  it('day 2: A and B land on their slots; C is still waiting', () => {
    expect(dueGroupsForDeckOnDay(states, IV, 2, today)).toEqual([
      { bucket: 0, due: 2, notDue: 0 },
      { bucket: 1, due: 1, notDue: 0 },
      { bucket: 2, due: 0, notDue: 1 },
    ]);
  });
});
