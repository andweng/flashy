// Pure scheduling logic — no I/O, no React. Safe to import anywhere.

import type { Card, CardState, Child, Deck } from '@/types/domain';

export const DEFAULT_BUCKET_INTERVALS = [1, 2, 4, 8, 16];

export function bucketLetter(index: number): string {
  return String.fromCharCode(65 + index);
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
// holding at least one non-graduated card appear, sorted by bucket index.
export function dueGroupsForDeckOnDay(
  states: { bucket_index: number; graduated_at: string | null }[],
  intervals: number[],
  cycleDay: number,
  realToday: string,
): { bucket: number; due: number; notDue: number }[] {
  const byBucket = new Map<number, { due: number; notDue: number }>();
  for (const s of states) {
    if (s.graduated_at) continue;
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
  graduated_at: string | null;
};

// True iff a non-graduated card is due on `today`. A null/absent last_tested_on
// means "force due now" (a fresh bucket-0 card, or a card cleared by a reset), so
// it always shows. Otherwise: due iff it has not been tested since its most recent
// scheduled slot — which keeps it due every day until tested (rollover), including
// across skipped days.
export function isDueToday(
  state: DueInputs,
  intervals: number[],
  cycleDay: number,
  today: string,
): boolean {
  if (state.graduated_at) return false;
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
  graduated: boolean;
};

// Apply a single review outcome under the last_tested_on model. There is no
// catch-up/backlog: a due card is graded exactly once. Both outcomes stamp
// last_tested_on = today, snapping the card onto its resulting bucket's grid.
// - fail: drop to bucket 0, reset top-bucket pass counter.
// - pass: promote one bucket (or stay at top); maybe graduate.
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
      graduated: false,
    };
  }

  const lastIndex = deck.bucket_intervals_days.length - 1;
  const atTop = state.bucket_index >= lastIndex;
  const nextBucket = atTop ? state.bucket_index : state.bucket_index + 1;
  const nextPasses = atTop ? state.consecutive_passes_in_top_bucket + 1 : 0;
  let graduatedAt: string | null = state.graduated_at;
  if (atTop && child.graduate_after_passes && nextPasses >= child.graduate_after_passes) {
    graduatedAt = nowIso;
  }

  return {
    next_state: {
      ...state,
      bucket_index: nextBucket,
      last_tested_on: today,
      consecutive_passes_in_top_bucket: nextPasses,
      graduated_at: graduatedAt,
      last_reviewed_at: nowIso,
    },
    graduated: !!graduatedAt && !state.graduated_at,
  };
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
