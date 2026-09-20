// Pure scheduling logic — no I/O, no React. Safe to import anywhere.

import type { Card, CardState, Child, Deck } from '@/types/domain';

export const DEFAULT_BUCKET_INTERVALS = [1, 2, 4, 8, 16];

export function bucketLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// ─── the permanent bucket ─────────────────────────────────────────────────────
// Permanent is not a flag hanging off a card, it is the deck's LAST bucket —
// one index past the configured intervals. That is the whole reason it can only
// ever be last: it has no interval of its own, so there is no coherent "permanent
// bucket A". Reaching it takes a card off the grid; the daily weighted lottery
// re-tests it instead (see "permanent pool draws" below). Moving a card there is
// an ordinary bucket change, and any move out of it is an ordinary bucket change
// back — no separate toggle, no second source of truth.
export function permanentBucketIndex(intervals: number[]): number {
  return intervals.length;
}

export function isPermanentBucket(bucketIndex: number, intervals: number[]): boolean {
  return bucketIndex >= permanentBucketIndex(intervals);
}

// Every bucket a card can be assigned to, grid buckets first and permanent last.
export function bucketIndexes(intervals: number[]): number[] {
  return Array.from({ length: intervals.length + 1 }, (_, i) => i);
}

// Display label. The permanent bucket has no interval, so it gets no letter.
export function bucketLabel(bucketIndex: number, intervals: number[]): string {
  return isPermanentBucket(bucketIndex, intervals)
    ? '🏆 Permanent'
    : `Bucket ${bucketLetter(bucketIndex)}`;
}

// Parses a comma- or space-separated list like "1, 3, 7, 11, 19" into intervals.
// Each value must be a positive integer; 2–10 values total (one per bucket).
export function parseIntervalsList(s: string): number[] {
  const parts = s.split(/[,\s]+/).filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error('Enter at least one interval.');
  if (parts.length < 2 || parts.length > 10) {
    throw new Error('Provide 2–10 intervals (one per bucket).');
  }
  const out: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Interval ${i + 1} ("${parts[i]}") must be a positive integer.`);
    }
    out.push(n);
  }
  return out;
}

export function todayInTz(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

export function daysBetween(a: string, b: string): number {
  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);
  return Math.round((bMs - aMs) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Current cycle day for a child given their stored cycle-start date (null ⇒ day 0,
// i.e. a fresh start). Clamped to ≥ 0 so a future-dated start can't go negative.
export function cycleDayOf(cycleStart: string | null, realToday: string): number {
  if (!cycleStart) return 0;
  return Math.max(0, daysBetween(cycleStart, realToday));
}

// The soonest day ≥ today on which the idealized fresh-start cycle would test a
// bucket-`bucketIndex` card sitting on cycle day `cycleDay` (bucket A due today;
// higher buckets one interval out on day 0). Used only by the deck schedule preview
// (dueGroupsForDeckOnDay); the live scheduler derives due-ness from last_tested_on.
export function dueDateForCycleDay(
  today: string,
  cycleDay: number,
  bucketIndex: number,
  intervals: number[],
): string {
  const interval = intervals[bucketIndex] ?? 1;
  if (cycleDay <= 0) {
    return bucketIndex <= 0 ? today : addDays(today, interval);
  }
  // Smallest positive multiple of `interval` at or after `cycleDay`.
  const nextTestDay = Math.ceil(cycleDay / interval) * interval;
  return addDays(today, nextTestDay - cycleDay);
}

// For the deck schedule preview: given a child's card_states in ONE deck, which
// buckets would have cards due on cycle day `cycleDay`, and how many. A card is due
// on day N iff its repositioned date equals today (dueDateForCycleDay returns
// exactly `today` when bucket i is tested on day N). Groups by bucket; only buckets
// holding at least one non-permanent card appear, sorted by bucket index.
export function dueGroupsForDeckOnDay(
  states: { bucket_index: number }[],
  intervals: number[],
  cycleDay: number,
  realToday: string,
): { bucket: number; due: number; notDue: number }[] {
  const byBucket = new Map<number, { due: number; notDue: number }>();
  for (const s of states) {
    if (isPermanentBucket(s.bucket_index, intervals)) continue;
    const isDue =
      dueDateForCycleDay(realToday, cycleDay, s.bucket_index, intervals) === realToday;
    const row = byBucket.get(s.bucket_index) ?? { due: 0, notDue: 0 };
    if (isDue) row.due += 1;
    else row.notDue += 1;
    byBucket.set(s.bucket_index, row);
  }
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, v]) => ({ bucket, due: v.due, notDue: v.notDue }));
}

// ─── last_tested_on scheduling model ─────────────────────────────────────────
// The redesigned scheduler. "Due today" is a pure function of the card's bucket,
// when it was last tested, and the child's cycle day for the deck (derived from
// the user-set start date) — no stored next_due_on and no owedReviews stacking.
//
// Buckets test on a shared grid: bucket b is scheduled on the cycle days that are
// multiples of its interval (0, iv, 2·iv, …). The start date sets the grid's phase.
// A card stays due until it is actually tested, so missed/skipped days roll over
// for free (as a single due, never a stacked backlog). A test snaps last_tested_on
// to today, re-aligning the card onto its (possibly new) bucket's grid.

// Date of the most recent scheduled slot for `bucketIndex`, on or before `today`,
// given the child's `cycleDay`. Bucket A (interval 1) ⇒ always today; a higher
// bucket ⇒ today minus how far we are past its last multiple-of-interval slot.
export function mostRecentSlot(
  today: string,
  cycleDay: number,
  bucketIndex: number,
  intervals: number[],
): string {
  const interval = intervals[bucketIndex] ?? 1;
  const phase = ((cycleDay % interval) + interval) % interval; // days since last slot
  return addDays(today, -phase);
}

type DueInputs = {
  bucket_index: number;
  last_tested_on?: string | null;
};

// True iff a non-permanent card is due on `today`. A null/absent last_tested_on
// means "force due now" (a fresh bucket-0 card, or a card cleared by a reset), so
// it always shows. Permanent (graduated) cards are never grid-due — they belong
// to the daily weighted lottery instead (see pickPermanentDraws below). Otherwise:
// due iff it has not been tested since its most recent scheduled slot — which
// keeps it due every day until tested (rollover), including across skipped days.
export function isDueToday(
  state: DueInputs,
  intervals: number[],
  cycleDay: number,
  today: string,
): boolean {
  if (isPermanentBucket(state.bucket_index, intervals)) return false;
  if (state.last_tested_on == null) return true;
  return state.last_tested_on < mostRecentSlot(today, cycleDay, state.bucket_index, intervals);
}

// last_tested_on for a freshly-created card_state. Bucket 0 (interval 1) enters
// today's rotation immediately (null ⇒ due). A higher bucket is marked "tested as
// of today" so it waits for its first real grid slot rather than showing today.
export function initialLastTested(today: string, bucketIndex: number): string | null {
  return bucketIndex <= 0 ? null : today;
}

export type ReviewAction = { kind: 'pass' } | { kind: 'fail' };

export type StateUpdate = {
  next_state: CardState;
  // True iff this pass just graduated the card into the permanent pool.
  enteredPermanent: boolean;
};

// Apply a single review outcome under the last_tested_on model. There is no
// catch-up/backlog: a due card is graded exactly once. Both outcomes stamp
// last_tested_on = today, snapping the card onto its resulting bucket's grid.
// - fail: drop to bucket 0, reset top-bucket pass counter. A permanent card is
//   just a card in the last bucket, so this sends it back to the grind for free.
// - pass: promote one bucket; at the top interval bucket, maybe graduate into the
//   permanent bucket (its last_tested_on stamp then anchors the lottery weight).
//   A card already in the permanent bucket stays there and keeps counting passes.
export function applyReview(
  state: CardState,
  deck: Deck,
  child: Child,
  today: string,
  action: ReviewAction,
): StateUpdate {
  const nowIso = new Date().toISOString();

  if (action.kind === 'fail') {
    return {
      next_state: {
        ...state,
        bucket_index: 0,
        last_tested_on: today,
        consecutive_passes_in_top_bucket: 0,
        last_reviewed_at: nowIso,
      },
      enteredPermanent: false,
    };
  }

  const permanentIndex = permanentBucketIndex(deck.bucket_intervals_days);
  const alreadyPermanent = state.bucket_index >= permanentIndex;
  // The top *interval* bucket — the last one a pass can promote out of.
  const atTop = state.bucket_index >= permanentIndex - 1;
  const nextPasses = atTop ? state.consecutive_passes_in_top_bucket + 1 : 0;
  const graduates =
    !alreadyPermanent &&
    atTop &&
    child.graduate_after_passes != null &&
    child.graduate_after_passes > 0 &&
    nextPasses >= child.graduate_after_passes;
  const nextBucket = alreadyPermanent || graduates
    ? permanentIndex
    : atTop
      ? state.bucket_index
      : state.bucket_index + 1;

  return {
    next_state: {
      ...state,
      bucket_index: nextBucket,
      last_tested_on: today,
      consecutive_passes_in_top_bucket: nextPasses,
      last_reviewed_at: nowIso,
    },
    enteredPermanent: graduates,
  };
}

// Manually move a card to a bucket, bypassing the natural promotion in
// applyReview. One path for every bucket, permanent included — it is just the
// last index (permanentBucketIndex), so there is nothing special to toggle.
// The card lands on its new bucket's natural schedule (initialLastTested: bucket
// A is due immediately, anything above waits for its first real slot, and
// permanent joins the lottery at weight 0 today so it is not drawn until a later
// day). The pass counter resets, so a card dropped out of permanent has to
// re-earn mastery instead of instantly re-graduating on its next top-bucket pass.
export function reBucket(state: CardState, bucketIndex: number, today: string): CardState {
  return {
    ...state,
    bucket_index: bucketIndex,
    last_tested_on: initialLastTested(today, bucketIndex),
    consecutive_passes_in_top_bucket: 0,
  };
}

// ─── permanent pool draws ─────────────────────────────────────────────────────
// Cards that reach mastery (the top-bucket pass threshold) don't retire — they
// move into the deck's permanent bucket (see "the permanent bucket" above) and
// keep getting re-tested by a daily weighted lottery: up to
// `permanent_draws_per_day` per child per day.
//
// - Weight = (days since last test)². A card tested today has weight 0 and is
//   impossible to redraw that day; the stalest cards dominate the draw.
// - COOLDOWN: weighting alone is not enough. It is memoryless, so a card tested
//   yesterday is still a legal pick today — unlikely per card, but across a whole
//   pool it surfaces often enough to read as "the same words again". So cards
//   tested within the last `permanentCooldownDays` days are barred outright: a
//   word cannot come back until the pool has had a real chance to cycle.
// - y is a DAILY BUDGET, not a queue length: a card tested today has spent one of
//   today's slots, so it drops off the list without another card taking its place.
//   That is what makes the due count fall to 0 as the set is completed, and what
//   keeps the pool rotating across days instead of being drained every day.
//   The cooldown deliberately does NOT feed this budget — a card sitting out is
//   not a card you reviewed, so barring it must never shrink the day's draw.
// - Draw size = min(y, pool): small pools get fully tested ("test all eligible").
// - No stored picks and no stored weight — everything derives from last_tested_on,
//   consistent with the derive-don't-store model above.
// - Deterministic per (childId, today) via a seeded PRNG: the same picks all day
//   (stable across refreshes), different picks tomorrow.

// FNV-1a 32-bit string hash → uint32 seed material.
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Small deterministic PRNG (mulberry32) → uniform float in [0, 1).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw weight for one permanent card, from `days` since its last test. The square
// tilts the draw hard towards the stalest cards; the cooldown below is what
// actually bars a recent one. d ≤ 0 (tested today, or a future-dated stamp) → 0.
export function permanentWeight(days: number): number {
  const d = Math.max(0, days);
  return d * d;
}

// How long a just-tested card sits out before it can be drawn again: half a pass
// through the pool at the current budget, so a word is never repeated until at
// least half the pool has been seen. Pools at or below 2y get 0 — they are meant
// to be tested (near-)daily, and a cooldown there would only starve the draw.
export function permanentCooldownDays(poolSize: number, y: number): number {
  if (y <= 0) return 0;
  return Math.floor(poolSize / (2 * y));
}

// Days since each pool card was last tested. A null stamp means "never tested"
// (a fresh pool member, or one cleared by "reset today") and has no anchor of its
// own, so it takes the stalest value in the pool + 1: never-tested outranks
// everything dated instead of being pinned at the bottom of the weighting, where
// it would be starved out of the draw forever.
function poolDaysSinceTest<T extends PermanentDrawCandidate>(
  pool: T[],
  today: string,
): { c: T; days: number }[] {
  const dated = pool.map((c) =>
    c.last_tested_on == null ? null : Math.max(0, daysBetween(c.last_tested_on, today)),
  );
  const neverTested = dated.reduce<number>((max, d) => (d != null && d > max ? d : max), 0) + 1;
  return pool.map((c, i) => ({ c, days: dated[i] ?? neverTested }));
}

export type PermanentDrawCandidate = {
  card_id: string;
  last_tested_on: string | null;
};

// Per-card draw key (Efraimidis–Spirakis): ln(u)/weight, where u is a uniform
// drawn from a PRNG seeded by (day seed, card). Taking the top-k keys is exactly
// weighted sampling without replacement — but unlike a sequential draw, each
// card's key depends ONLY on itself, so reviewing one card leaves every other
// card's key untouched and the rest of the day's set intact.
function drawKey(cardId: string, weight: number, seedStr: string): number {
  return Math.log(mulberry32(hashSeed(`${seedStr}:${cardId}`))()) / weight;
}

// Today's outstanding permanent draws, seeded deterministically by `seedStr`
// (pass something like `keeper:${childId}:${today}`): same pool + y + today +
// seed → same picks, every call.
//
// y is the day's budget. Cards already tested today have used a slot (drawn and
// reviewed, freshly graduated, or just toggled into the pool), so they are both
// excluded from the result AND counted against y — the list shrinks one card at
// a time as the child works through it and hits 0 when the budget is spent,
// instead of refilling itself from the rest of the pool.
//
// `spentOutsidePool` closes the hole in deriving that spend from the pool alone:
// a miss drops a card to bucket 0, so a card answered today can leave the pool
// and stop counting, silently refunding its slot and letting the lottery draw a
// replacement — a child who misses everything drains the whole pool in one day.
// The caller counts those from the review log (which records what each card was
// before the answer) and passes them in.
export function pickPermanentDraws<T extends PermanentDrawCandidate>(
  pool: T[],
  y: number,
  today: string,
  seedStr: string,
  spentOutsidePool = 0,
): T[] {
  if (y <= 0 || pool.length === 0) return [];
  const rows = poolDaysSinceTest(pool, today);
  const testedToday = rows.filter((r) => r.days <= 0).length;
  // Everything answered today has spent a slot, whether or not the lottery drew
  // it and whether or not it is still in the pool.
  const slots = Math.min(y - testedToday - spentOutsidePool, rows.length - testedToday);
  if (slots <= 0) return [];

  // Bar anything still inside its cooldown. The cooldown depends only on the pool
  // size and y — both fixed for the day — so reviewing one card removes exactly
  // that card from the candidates and leaves every other key untouched. If the
  // pool cannot field enough rested cards (a burst of same-day graduations, say),
  // drop the bar wholesale rather than short-change the day's draw.
  const cooldown = permanentCooldownDays(pool.length, y);
  const rested = rows.filter((r) => r.days > cooldown);
  const candidates = rested.length >= slots ? rested : rows.filter((r) => r.days > 0);

  return candidates
    .map((e) => ({ c: e.c, key: drawKey(e.c.card_id, permanentWeight(e.days), seedStr) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, slots)
    .map((e) => e.c);
}

// Normalize typed input for auto-checking (case + whitespace + simple punctuation).
// Intentionally simple; refine later (accents, plurals, etc.).
export function normalizeTypedInput(s: string): string {
  return s.trim().toLowerCase().replace(/[.,!?;:]+$/g, '').replace(/\s+/g, ' ');
}

export function checkTypedAnswer(card: Card, input: string): boolean {
  const target = normalizeTypedInput(input);
  if (normalizeTypedInput(card.back) === target) return true;
  return card.typed_alternates.some((alt) => normalizeTypedInput(alt) === target);
}
