// Tests for the permanent-pool daily lottery (pickPermanentDraws):
// determinism, "test all eligible", zero-weight exclusion, and the statistical
// property that recently-tested cards are unlikely to be re-drawn. All draws are
// seeded, so every assertion here is fully reproducible.

import {
  addDays,
  DEFAULT_BUCKET_INTERVALS,
  isDueToday,
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
    expect(permanentWeight(BASE, BASE)).toBe(0);
  });

  it('future-dated stamp clamps to 0', () => {
    expect(permanentWeight(addDays(BASE, 3), BASE)).toBe(0);
  });

  it('null (never tested / just reset) → 1: eligible but deprioritized', () => {
    expect(permanentWeight(null, BASE)).toBe(1);
  });

  it('grows quadratically with days since last test', () => {
    expect(permanentWeight(addDays(BASE, -1), BASE)).toBe(1);
    expect(permanentWeight(addDays(BASE, -3), BASE)).toBe(9);
    expect(permanentWeight(addDays(BASE, -10), BASE)).toBe(100);
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

  it('still tests the whole pool when every card is zero-weight (e.g. small pool, all tested earlier today)', () => {
    const pool = makePool(3, 0); // all tested today → weight 0
    const drawn = pickPermanentDraws(pool, 3, BASE, 'keeper:child-1');
    expect(drawn.length).toBe(3);
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
    const pool = makePool(10, 5);
    pool[0].last_tested_on = BASE; // just tested
    for (let d = 0; d < 30; d++) {
      const today = addDays(BASE, d);
      const drawn = pickPermanentDraws(pool, 4, today, 'keeper:child-1');
      expect(drawn.map((c) => c.card_id)).not.toContain('c0');
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
    // Immediate re-tests are statistically rare (a card tested today has weight
    // 0 that day, then weight 1 vs ~25 for the rest of the pool the next day).
    expect(consecutiveDayRepeats).toBeLessThanOrEqual(15);
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
