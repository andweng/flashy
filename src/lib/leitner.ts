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

// Due date for a card freshly placed into a bucket. Bucket A (index 0) is due
// immediately so brand-new cards enter today's rotation right away; any higher
// bucket waits one full interval, so a card dropped straight into E isn't due
// until its first E review comes around (rather than showing up today).
export function initialDueDate(today: string, bucketIndex: number, intervals: number[]): string {
  if (bucketIndex <= 0) return today;
  return addDays(today, intervals[bucketIndex] ?? 1);
}

// Current cycle day for a child given their stored cycle-start date (null ⇒ day 0,
// i.e. a fresh start). Clamped to ≥ 0 so a future-dated start can't go negative.
export function cycleDayOf(cycleStart: string | null, realToday: string): number {
  if (!cycleStart) return 0;
  return Math.max(0, daysBetween(cycleStart, realToday));
}

// `next_due_on` for a bucket-`bucketIndex` card when the child sits on cycle day
// `cycleDay`, with NO accumulated backlog: the soonest day ≥ today on which the
// idealized fresh-start cycle would test that bucket. Day 0 mirrors initialDueDate
// (bucket A due today; higher buckets one interval out). Never returns a past date,
// so owedReviews yields exactly 1 for a card due today.
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

// How many reviews a card owes by `today`. 0 if not due, ≥1 if due (incl. backlog).
export function owedReviews(state: CardState, deck: Deck, today: string): number {
  if (state.graduated_at) return 0;
  const overdue = daysBetween(state.next_due_on, today);
  if (overdue < 0) return 0;
  const interval = deck.bucket_intervals_days[state.bucket_index] ?? 1;
  return Math.floor(overdue / interval) + 1;
}

export type ReviewAction = { kind: 'pass' } | { kind: 'fail' };

export type StateUpdate = {
  next_state: CardState;
  graduated: boolean;
};

// Apply a single owed-review action. Caller knows if this is the final owed review.
// - fail: drop to bucket 0, reset due date, reset top-bucket pass counter.
// - pass (catch-up): stay in bucket, advance next_due_on by one interval.
// - pass (final): promote bucket (or stay at top); maybe graduate.
export function applyReview(
  state: CardState,
  deck: Deck,
  child: Child,
  today: string,
  action: ReviewAction,
  isLastOwed: boolean,
): StateUpdate {
  const nowIso = new Date().toISOString();

  if (action.kind === 'fail') {
    return {
      next_state: {
        ...state,
        bucket_index: 0,
        next_due_on: addDays(today, deck.bucket_intervals_days[0] ?? 1),
        consecutive_passes_in_top_bucket: 0,
        last_reviewed_at: nowIso,
      },
      graduated: false,
    };
  }

  if (!isLastOwed) {
    const interval = deck.bucket_intervals_days[state.bucket_index] ?? 1;
    return {
      next_state: {
        ...state,
        next_due_on: addDays(state.next_due_on, interval),
        last_reviewed_at: nowIso,
      },
      graduated: false,
    };
  }

  const lastIndex = deck.bucket_intervals_days.length - 1;
  const atTop = state.bucket_index >= lastIndex;
  const nextBucket = atTop ? state.bucket_index : state.bucket_index + 1;
  const interval = deck.bucket_intervals_days[nextBucket] ?? 1;
  let nextPasses = atTop ? state.consecutive_passes_in_top_bucket + 1 : 0;
  let graduatedAt: string | null = state.graduated_at;
  if (atTop && child.graduate_after_passes && nextPasses >= child.graduate_after_passes) {
    graduatedAt = nowIso;
  }

  return {
    next_state: {
      ...state,
      bucket_index: nextBucket,
      next_due_on: addDays(today, interval),
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
