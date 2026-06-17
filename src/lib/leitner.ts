// Pure scheduling logic — no I/O, no React. Safe to import anywhere.

import type { Card, CardState, Child, Deck } from '@/types/domain';

export const DEFAULT_BUCKET_INTERVALS = [1, 2, 4, 8, 16];

export function bucketLetter(index: number): string {
  return String.fromCharCode(65 + index);
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
