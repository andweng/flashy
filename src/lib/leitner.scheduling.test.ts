// Design contract for the redesigned "last_tested_on" scheduler.
// These tests ARE the spec: due-ness is a pure function of bucket + last_tested_on
// + the child's cycle day (from the user-set start date). Missed/skipped days roll
// over as a single due (never a stacked backlog); a test snaps the card onto its
// bucket's shared grid. See leitner.ts "last_tested_on scheduling model".

import {
  addDays,
  applyReview,
  initialLastTested,
  isDueToday,
  mostRecentSlot,
} from '@/lib/leitner';
import type { CardState, Child, Deck } from '@/types/domain';

const TODAY = '2026-07-08';
// A=1, B=2, C=4, D=8, E=16 (classic doubling).
const IV = [1, 2, 4, 8, 16];
const A = 0;
const B = 1;
const C = 2;
const D = 3;
const E = 4;

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    parent_id: 'p1',
    name: 'Deck',
    description: null,
    bucket_intervals_days: IV,
    ...overrides,
  };
}

function makeChild(overrides: Partial<Child> = {}): Child {
  return {
    id: 'c1',
    parent_id: 'p1',
    display_name: 'Kid',
    avatar: null,
    graduate_after_passes: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<CardState> = {}): CardState {
  return {
    child_id: 'c1',
    card_id: 'card-1',
    bucket_index: A,
    last_tested_on: null,
    consecutive_passes_in_top_bucket: 0,
    graduated_at: null,
    last_reviewed_at: null,
    ...overrides,
  };
}

describe('mostRecentSlot', () => {
  it('bucket A (interval 1) is scheduled every day → always today', () => {
    for (const cycleDay of [0, 1, 5, 6, 99]) {
      expect(mostRecentSlot(TODAY, cycleDay, A, IV)).toBe(TODAY);
    }
  });

  it('bucket C (interval 4) lands on multiples of 4; today minus the phase otherwise', () => {
    expect(mostRecentSlot(TODAY, 0, C, IV)).toBe(TODAY); // slot
    expect(mostRecentSlot(TODAY, 4, C, IV)).toBe(TODAY); // slot
    expect(mostRecentSlot(TODAY, 8, C, IV)).toBe(TODAY); // slot
    expect(mostRecentSlot(TODAY, 5, C, IV)).toBe(addDays(TODAY, -1));
    expect(mostRecentSlot(TODAY, 6, C, IV)).toBe(addDays(TODAY, -2));
    expect(mostRecentSlot(TODAY, 7, C, IV)).toBe(addDays(TODAY, -3));
  });

  it('bucket E (interval 16) walks back to its last multiple-of-16 slot', () => {
    expect(mostRecentSlot(TODAY, 16, E, IV)).toBe(TODAY);
    expect(mostRecentSlot(TODAY, 20, E, IV)).toBe(addDays(TODAY, -4));
    expect(mostRecentSlot(TODAY, 15, E, IV)).toBe(addDays(TODAY, -15));
  });

  it('defaults a missing interval to 1 (behaves like bucket A)', () => {
    expect(mostRecentSlot(TODAY, 5, 99, IV)).toBe(TODAY);
  });
});

describe('isDueToday', () => {
  it('graduated cards are never due', () => {
    const s = makeState({ graduated_at: '2026-01-01T00:00:00Z', last_tested_on: null });
    expect(isDueToday(s, IV, 0, TODAY)).toBe(false);
  });

  it('null last_tested_on forces due now, for any bucket', () => {
    expect(isDueToday(makeState({ bucket_index: A, last_tested_on: null }), IV, 0, TODAY)).toBe(true);
    expect(isDueToday(makeState({ bucket_index: E, last_tested_on: null }), IV, 3, TODAY)).toBe(true);
  });

  it('bucket A: due every day unless already tested today (daily rollover)', () => {
    expect(isDueToday(makeState({ bucket_index: A, last_tested_on: TODAY }), IV, 10, TODAY)).toBe(false);
    expect(
      isDueToday(makeState({ bucket_index: A, last_tested_on: addDays(TODAY, -1) }), IV, 10, TODAY),
    ).toBe(true);
  });

  it('bucket C on a slot day: due only if not tested since the slot', () => {
    const cycleDay = 4; // slot === today
    expect(isDueToday(makeState({ bucket_index: C, last_tested_on: TODAY }), IV, cycleDay, TODAY)).toBe(false);
    expect(
      isDueToday(makeState({ bucket_index: C, last_tested_on: addDays(TODAY, -1) }), IV, cycleDay, TODAY),
    ).toBe(true);
  });

  it('bucket C mid-interval: compares against the most recent slot, not today', () => {
    const cycleDay = 5; // slot === yesterday
    // tested on the slot (yesterday) → satisfied, not due.
    expect(
      isDueToday(makeState({ bucket_index: C, last_tested_on: addDays(TODAY, -1) }), IV, cycleDay, TODAY),
    ).toBe(false);
    // tested before the slot → still owed, due.
    expect(
      isDueToday(makeState({ bucket_index: C, last_tested_on: addDays(TODAY, -2) }), IV, cycleDay, TODAY),
    ).toBe(true);
  });

  it('due-ness depends on the cycle day (i.e. on the user-set start date)', () => {
    // Same card, same last_tested_on — only the cycle day (start date) differs.
    const s = makeState({ bucket_index: C, last_tested_on: addDays(TODAY, -1) });
    expect(isDueToday(s, IV, 4, TODAY)).toBe(true); // slot today: -1 < today
    expect(isDueToday(s, IV, 5, TODAY)).toBe(false); // slot yesterday: -1 !< -1
  });

  it('a card missed for many intervals is due exactly once (no stacked backlog)', () => {
    // Bucket C last tested ~3 slots ago; on a slot day it is simply "due" (boolean),
    // not owed 3+ times the way the legacy owedReviews model stacked it.
    const s = makeState({ bucket_index: C, last_tested_on: addDays(TODAY, -13) });
    expect(isDueToday(s, IV, 12, TODAY)).toBe(true);
  });
});

describe('initialLastTested', () => {
  it('bucket 0 starts null → enters today’s rotation immediately', () => {
    expect(initialLastTested(TODAY, A)).toBeNull();
    const fresh = makeState({ bucket_index: A, last_tested_on: initialLastTested(TODAY, A) });
    expect(isDueToday(fresh, IV, 0, TODAY)).toBe(true);
  });

  it('a higher bucket starts "tested as of today" → waits for its first slot', () => {
    expect(initialLastTested(TODAY, C)).toBe(TODAY);
    const fresh = makeState({ bucket_index: C, last_tested_on: initialLastTested(TODAY, C) });
    // Created on cycle day 0: not due today...
    expect(isDueToday(fresh, IV, 0, TODAY)).toBe(false);
    // ...but due when its first grid slot arrives (cycle day 4, four days later).
    expect(isDueToday(fresh, IV, 4, addDays(TODAY, 4))).toBe(true);
  });
});

describe('applyReview', () => {
  const deck = makeDeck();
  const child = makeChild();

  it('fail drops to bucket 0, stamps last_tested_on, resets pass counter', () => {
    const s = makeState({ bucket_index: D, consecutive_passes_in_top_bucket: 3 });
    const { next_state, graduated } = applyReview(s, deck, child, TODAY, { kind: 'fail' });
    expect(next_state.bucket_index).toBe(A);
    expect(next_state.last_tested_on).toBe(TODAY);
    expect(next_state.consecutive_passes_in_top_bucket).toBe(0);
    expect(next_state.graduated_at).toBeNull();
    expect(next_state.last_reviewed_at).toEqual(expect.any(String));
    expect(graduated).toBe(false);
  });

  it('pass below the top promotes one bucket and stamps last_tested_on', () => {
    const s = makeState({ bucket_index: C, consecutive_passes_in_top_bucket: 0 });
    const { next_state, graduated } = applyReview(s, deck, child, TODAY, { kind: 'pass' });
    expect(next_state.bucket_index).toBe(D);
    expect(next_state.last_tested_on).toBe(TODAY);
    expect(graduated).toBe(false);
  });

  it('pass at the top stays put and counts consecutive passes (no graduation configured)', () => {
    const s = makeState({ bucket_index: E, consecutive_passes_in_top_bucket: 4 });
    const { next_state, graduated } = applyReview(s, deck, child, TODAY, { kind: 'pass' });
    expect(next_state.bucket_index).toBe(E);
    expect(next_state.consecutive_passes_in_top_bucket).toBe(5);
    expect(next_state.graduated_at).toBeNull();
    expect(graduated).toBe(false);
  });

  it('promoting off a lower bucket resets the top-bucket pass counter to 0', () => {
    const s = makeState({ bucket_index: A, consecutive_passes_in_top_bucket: 2 });
    const { next_state } = applyReview(s, deck, child, TODAY, { kind: 'pass' });
    expect(next_state.bucket_index).toBe(B);
    expect(next_state.consecutive_passes_in_top_bucket).toBe(0);
  });

  it('graduates once the top-bucket pass threshold is reached', () => {
    const gradChild = makeChild({ graduate_after_passes: 2 });
    const s = makeState({ bucket_index: E, consecutive_passes_in_top_bucket: 1 });
    const { next_state, graduated } = applyReview(s, deck, gradChild, TODAY, { kind: 'pass' });
    expect(next_state.consecutive_passes_in_top_bucket).toBe(2);
    expect(next_state.graduated_at).toEqual(expect.any(String));
    expect(graduated).toBe(true);
  });

  it('does not graduate before the threshold', () => {
    const gradChild = makeChild({ graduate_after_passes: 3 });
    const s = makeState({ bucket_index: E, consecutive_passes_in_top_bucket: 1 });
    const { next_state, graduated } = applyReview(s, deck, gradChild, TODAY, { kind: 'pass' });
    expect(next_state.consecutive_passes_in_top_bucket).toBe(2);
    expect(next_state.graduated_at).toBeNull();
    expect(graduated).toBe(false);
  });

});

// End-to-end walks over a small deck (A=1, B=2, C=4) confirm the model behaves as
// designed across real days: grid alignment, rollover, skip, and fail-resets.
describe('multi-day schedule walks (intervals [1,2,4])', () => {
  const deck = makeDeck({ bucket_intervals_days: [1, 2, 4] });
  const child = makeChild();
  const START = TODAY; // cycle day 0 == START

  it('passing every due day follows the shared bucket grid: due on days 0,2,4,8,12', () => {
    let state = makeState({ bucket_index: A, last_tested_on: initialLastTested(START, A) });
    const dueDays: number[] = [];
    for (let day = 0; day <= 12; day++) {
      const today = addDays(START, day);
      if (isDueToday(state, deck.bucket_intervals_days, day, today)) {
        dueDays.push(day);
        state = applyReview(state, deck, child, today, { kind: 'pass' }).next_state;
      }
    }
    expect(dueDays).toEqual([0, 2, 4, 8, 12]);
  });

  it('a fail sends the card back to daily bucket A the very next day', () => {
    // Card sitting in C, due on cycle day 4.
    let state = makeState({ bucket_index: C, last_tested_on: addDays(START, 0) });
    const day4 = addDays(START, 4);
    expect(isDueToday(state, deck.bucket_intervals_days, 4, day4)).toBe(true);
    state = applyReview(state, deck, child, day4, { kind: 'fail' }).next_state;
    expect(state.bucket_index).toBe(A);

    const day5 = addDays(START, 5);
    expect(isDueToday(state, deck.bucket_intervals_days, 5, day5)).toBe(true); // daily now
  });

  it('skipping a due card keeps it due every following day until it is tested', () => {
    // Bucket B card, due on cycle day 2. "Skip" = leave the state untouched.
    const state = makeState({ bucket_index: B, last_tested_on: addDays(START, 0) });
    expect(isDueToday(state, deck.bucket_intervals_days, 2, addDays(START, 2))).toBe(true); // due
    // Skipped — no write. Still due on the off-grid days that follow.
    expect(isDueToday(state, deck.bucket_intervals_days, 3, addDays(START, 3))).toBe(true);
    expect(isDueToday(state, deck.bucket_intervals_days, 4, addDays(START, 4))).toBe(true);
  });
});
