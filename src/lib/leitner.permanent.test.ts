// Tests for the permanent-pool daily lottery (pickPermanentDraws):
// determinism, "test all eligible", zero-weight exclusion, and the statistical
// property that recently-tested cards are unlikely to be re-drawn. All draws are
// seeded, so every assertion here is fully reproducible.

import {
  addDays,
  DEFAULT_BUCKET_INTERVALS,
  isDueToday,
  permanentCooldownDays,
  pickPermanentDraws,
  permanentWeight,
  togglePermanent,
} from '@/lib/leitner';
import type { PermanentDrawCandidate } from '@/lib/leitner';
import type { CardState } from '@/types/domain';

const BASE = '2026-07-08';

type PoolCard = PermanentDrawCandidate & { card_id: string };

function makePool(size: number, lastTestedDaysAgo: number | null): PoolCard[] {
  return Array.from({ length: size }, (_, i) => ({
    card_id: `c${i}`,
    permanent_at: '2026-01-01T00:00:00Z',
    last_tested_on: lastTestedDaysAgo == null ? null : addDays(BASE, -lastTestedDaysAgo),
  }));
}

describe('permanentWeight', () => {
  it('tested today → 0 (impossible to redraw that day)', () => {
    expect(permanentWeight(0)).toBe(0);
  });

  it('a future-dated stamp clamps to 0', () => {
    expect(permanentWeight(-3)).toBe(0);
  });

  it('grows quadratically with days since last test', () => {
    expect(permanentWeight(1)).toBe(1);
    expect(permanentWeight(3)).toBe(9);
    expect(permanentWeight(10)).toBe(100);
  });
});

describe('permanentCooldownDays', () => {
  it('is half a pass through the pool at the current budget', () => {
    expect(permanentCooldownDays(50, 5)).toBe(5);
    expect(permanentCooldownDays(20, 4)).toBe(2);
  });

  it('is 0 for pools at or below 2y, which are meant to be tested (near-)daily', () => {
    expect(permanentCooldownDays(8, 5)).toBe(0);
    expect(permanentCooldownDays(10, 5)).toBe(1);
    expect(permanentCooldownDays(3, 7)).toBe(0);
  });

  it('is 0 when the child draws nothing', () => {
    expect(permanentCooldownDays(50, 0)).toBe(0);
  });
});

describe('pickPermanentDraws — the cooldown', () => {
  it('never re-draws a card inside its cooldown window', () => {
    // 40-card pool, 4 draws/day ⇒ a 5-day cooldown. Walk a year and assert no
    // card ever comes back sooner than that.
    const pool = makePool(40, 30);
    const lastDrawn = new Map<string, number>();
    for (let d = 0; d < 365; d++) {
      const today = addDays(BASE, d);
      for (const c of pickPermanentDraws(pool, 4, today, `keeper:child-1:${today}`)) {
        const previous = lastDrawn.get(c.card_id);
        if (previous != null) expect(d - previous).toBeGreaterThan(5);
        lastDrawn.set(c.card_id, d);
        c.last_tested_on = today;
      }
    }
    expect(lastDrawn.size).toBe(40); // and every card still gets its turn
  });

  it('still fills the day when the pool cannot field enough rested cards', () => {
    // 20 cards all tested 1 day ago: a 2-day cooldown would bar the whole pool,
    // so the bar drops rather than starving the draw.
    const pool = makePool(20, 1);
    expect(pickPermanentDraws(pool, 4, BASE, `keeper:child-1:${BASE}`).length).toBe(4);
  });

  it('a never-tested card outranks everything dated instead of being starved', () => {
    // last_tested_on = null is what "reset today" leaves behind. It has no anchor
    // of its own, so it is weighted as the stalest card in the pool — here that
    // makes it the only one past the cooldown, so it is the pick. Under a fixed
    // floor weight it would instead sit below every dated card, forever.
    const pool = makePool(12, 6);
    pool.push({ card_id: 'reset', permanent_at: '2026-01-01T00:00:00Z', last_tested_on: null });
    const drawn = pickPermanentDraws(pool, 1, BASE, `keeper:child-1:${BASE}`);
    expect(drawn.map((c) => c.card_id)).toEqual(['reset']);
  });
});

describe('pickPermanentDraws — basic behavior', () => {
  it('y ≤ 0 or empty pool → no draws', () => {
    const pool = makePool(5, 5);
    expect(pickPermanentDraws(pool, 0, BASE, 'keeper:x')).toEqual([]);
    expect(pickPermanentDraws(pool, -1, BASE, 'keeper:x')).toEqual([]);
    expect(pickPermanentDraws([], 5, BASE, 'keeper:x')).toEqual([]);
  });

  it('is deterministic: same pool + y + day + seed → same picks, every call', () => {
    const pool = makePool(10, 5);
    const a = pickPermanentDraws(pool, 3, BASE, 'keeper:child-1');
    const b = pickPermanentDraws(pool, 3, BASE, 'keeper:child-1');
    expect(a.map((c) => c.card_id)).toEqual(b.map((c) => c.card_id));
  });

  it('draws min(y, pool) cards — a small pool is fully tested ("test all eligible")', () => {
    const pool = makePool(3, 5);
    const drawn = pickPermanentDraws(pool, 7, BASE, 'keeper:child-1');
    expect(drawn.length).toBe(3);
    expect(new Set(drawn.map((c) => c.card_id))).toEqual(new Set(['c0', 'c1', 'c2']));
  });

  it('draws nothing when every card was tested today (the due count falls to 0)', () => {
    const pool = makePool(3, 0); // all tested today → weight 0 → none eligible
    const drawn = pickPermanentDraws(pool, 3, BASE, 'keeper:child-1');
    expect(drawn.length).toBe(0);
  });

  it('completing a small pool leaves nothing due: reviewed cards drop off the same day', () => {
    const pool = makePool(8, 3); // 8 permanent cards, each last tested 3 days ago
    const first = pickPermanentDraws(pool, 8, BASE, 'keeper:child-1');
    expect(first.length).toBe(8); // all 8 eligible today
    first.forEach((c) => {
      c.last_tested_on = BASE; // simulate reviewing all 8 today
    });
    const second = pickPermanentDraws(pool, 8, BASE, 'keeper:child-1');
    expect(second.length).toBe(0); // all tested today → nothing left due
  });

  it('changes picks across days (the seed includes today)', () => {
    const pool = makePool(20, 5);
    let differs = false;
    for (let d = 0; d < 10; d++) {
      const today = addDays(BASE, d);
      // Same seed convention as the DB layers: keeper:${childId}:${today}.
      const a = pickPermanentDraws(pool, 4, today, `keeper:child-1:${today}`).map((c) => c.card_id);
      const b = pickPermanentDraws(pool, 4, addDays(today, 1), `keeper:child-1:${addDays(today, 1)}`).map(
        (c) => c.card_id,
      );
      if (a.some((id, i) => id !== b[i])) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe('pickPermanentDraws — deprioritization of recent tests', () => {
  it('a card tested today (weight 0) is never drawn while other cards have weight', () => {
    // Rebuild the pool each day so c0 is genuinely tested *that* day — the
    // property being asserted. (It also costs one of the day's draw slots, so
    // only 3 of 4 are drawn.)
    for (let d = 0; d < 30; d++) {
      const today = addDays(BASE, d);
      const pool = makePool(10, 5);
      pool[0].last_tested_on = today;
      const drawn = pickPermanentDraws(pool, 4, today, 'keeper:child-1');
      expect(drawn.map((c) => c.card_id)).not.toContain('c0');
      expect(drawn.length).toBe(3);
    }
  });

  it('steady-state fairness: every card in the pool gets re-tested at a similar rate', () => {
    // 20-card pool, 4 draws/day for 60 days (seeded ⇒ reproducible). Expected
    // draws per card ≈ 60 × 4 / 20 = 12; the squared weights keep the spread
    // tight.
    const pool = makePool(20, 5);
    const counts = new Map<string, number>(pool.map((c) => [c.card_id, 0]));
    let consecutiveDayRepeats = 0;
    let previous = new Set<string>();
    for (let d = 0; d < 60; d++) {
      const today = addDays(BASE, d);
      const drawn = pickPermanentDraws(pool, 4, today, `keeper:child-1:${today}`);
      for (const c of drawn) {
        counts.set(c.card_id, (counts.get(c.card_id) ?? 0) + 1);
        c.last_tested_on = today;
      }
      const drawnIds = new Set(drawn.map((c) => c.card_id));
      for (const id of drawnIds) if (previous.has(id)) consecutiveDayRepeats += 1;
      previous = drawnIds;
    }
    for (const n of counts.values()) {
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(19);
    }
    // The cooldown makes an immediate re-test impossible, not merely unlikely.
    expect(consecutiveDayRepeats).toBe(0);
  });
});

function makeState(overrides: Partial<CardState> = {}): CardState {
  return {
    child_id: 'c1',
    card_id: 'k1',
    bucket_index: 0,
    last_tested_on: addDays(BASE, -3),
    consecutive_passes_in_top_bucket: 0,
    permanent_at: null,
    last_reviewed_at: null,
    ...overrides,
  };
}

describe('togglePermanent', () => {
  const intervals = DEFAULT_BUCKET_INTERVALS;

  it('promote: sets permanent_at, stamps last_tested_on = today, becomes non-due', () => {
    const out = togglePermanent(makeState(), BASE);
    expect(out.permanent_at).not.toBeNull();
    expect(out.last_tested_on).toBe(BASE);
    expect(isDueToday(out, intervals, 5, BASE)).toBe(false);
  });

  it('promote: preserves bucket + pass counter (manual override from any bucket)', () => {
    const out = togglePermanent(makeState({ bucket_index: 2, consecutive_passes_in_top_bucket: 1 }), BASE);
    expect(out.bucket_index).toBe(2);
    expect(out.consecutive_passes_in_top_bucket).toBe(1);
  });

  it('demote: clears permanent_at, stamps today, resets pass counter, keeps bucket', () => {
    const out = togglePermanent(
      makeState({
        permanent_at: '2026-01-01T00:00:00Z',
        bucket_index: 3,
        consecutive_passes_in_top_bucket: 3,
      }),
      BASE,
    );
    expect(out.permanent_at).toBeNull();
    expect(out.last_tested_on).toBe(BASE);
    expect(out.consecutive_passes_in_top_bucket).toBe(0);
    expect(out.bucket_index).toBe(3);
  });

  it('round-trips: promote → demote leaves a non-permanent grid card', () => {
    const out = togglePermanent(togglePermanent(makeState(), BASE), BASE);
    expect(out.permanent_at).toBeNull();
    expect(out.last_tested_on).toBe(BASE);
  });
});

// Regression: the day's draw is a fixed budget of y cards, not a rolling refill.
// Before this, pickPermanentDraws sampled y cards from whatever was still
// eligible on every call, so completing today's set immediately drew y *fresh*
// cards — the due count never fell below y, and the whole pool got re-tested
// every single day instead of y of it.
describe('pickPermanentDraws — the daily budget is y, not a refill', () => {
  it('completing the day\'s draws leaves nothing due (no backfill from the rest of the pool)', () => {
    const pool = makePool(20, 5);
    const first = pickPermanentDraws(pool, 8, BASE, `keeper:child-1:${BASE}`);
    expect(first.length).toBe(8);
    first.forEach((c) => {
      c.last_tested_on = BASE; // reviewed today
    });
    expect(pickPermanentDraws(pool, 8, BASE, `keeper:child-1:${BASE}`)).toEqual([]);
  });

  it('the count falls one at a time as cards are reviewed', () => {
    const pool = makePool(20, 5);
    const drawn = pickPermanentDraws(pool, 8, BASE, `keeper:child-1:${BASE}`);
    for (let done = 1; done <= 8; done++) {
      drawn[done - 1].last_tested_on = BASE;
      expect(pickPermanentDraws(pool, 8, BASE, `keeper:child-1:${BASE}`).length).toBe(8 - done);
    }
  });

  it('the rest of the day\'s set is unchanged when one card is reviewed', () => {
    const pool = makePool(20, 5);
    const drawn = pickPermanentDraws(pool, 8, BASE, `keeper:child-1:${BASE}`);
    const reviewed = drawn[3];
    reviewed.last_tested_on = BASE;
    const still = pickPermanentDraws(pool, 8, BASE, `keeper:child-1:${BASE}`);
    expect(new Set(still.map((c) => c.card_id))).toEqual(
      new Set(drawn.filter((c) => c !== reviewed).map((c) => c.card_id)),
    );
  });

  it('tests only y cards per day even when the child keeps reviewing all day', () => {
    const pool = makePool(20, 5);
    for (let d = 0; d < 5; d++) {
      const today = addDays(BASE, d);
      const tested = new Set<string>();
      // Keep asking for the day's draws and reviewing them, as the app does on
      // every home/review load, until the day is genuinely done.
      for (let guard = 0; guard < 10; guard++) {
        const drawn = pickPermanentDraws(pool, 8, today, `keeper:child-1:${today}`);
        if (drawn.length === 0) break;
        drawn.forEach((c) => {
          tested.add(c.card_id);
          c.last_tested_on = today;
        });
      }
      expect(tested.size).toBe(8);
    }
  });
});
