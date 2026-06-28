# Per-child "what day am I on" → reposition the schedule (no backlog)

Date: 2026-06-28
Status: approved (brainstorm)

## Problem

The per-child "what day am I on" control in Settings is meant to position a child at a
point in their Leitner cycle and update their cards' due dates to match. Instead, setting
it makes **all of a child's cards due at once** (often with large phantom backlogs).

Root cause: `day_offset` is a **read-time threshold**, not a re-scheduling. Due is computed
as `next_due_on <= getEffectiveToday(tz, day_offset)` where `getEffectiveToday = realToday +
day_offset` ([home.tsx:25](../../../src/app/(app)/home.tsx), [index.tsx:40](../../../src/app/index.tsx),
[review.tsx:49](../../../src/app/(app)/review.tsx), filtered in
[supabase.ts:267](../../../src/lib/db/supabase.ts) / [mock.ts:258](../../../src/lib/db/mock.ts)).
The stored `next_due_on` values are never touched when the offset changes
([settings.tsx applyDayOffset](../../../src/app/(app)/settings.tsx) only writes the offset).
So bumping the offset to N slides "today" forward N days while every stored date stays put —
every card scheduled within the next N days flips to due, and `owedReviews` inflates each by
the overdue span (e.g. offset 16 on a 1-day card ⇒ `floor(16/1)+1 = 17` owed for one card).

A secondary, related smell (already noted in the test-harness spec): `createCard` /
`assignDeckToChild` write `next_due_on` via `getEffectiveToday()` with **no** offset, so on a
child with `day_offset > 0` a brand-new card is instantly "overdue."

"All children" is not a cross-child leak — the offset is per-child in storage and in every
read. The symptom reproduces on **each** child the control is applied to.

## Decision (from brainstorm)

1. **Reposition, no backlog.** Setting a child to day N rewrites each of that child's
   `next_due_on` so the card is due on the soonest day ≥ today that the idealized cycle tests
   its bucket. A card due today owes exactly 1; nothing piles up. On day 3 with `[1,2,4,8,16]`
   only buckets tested that day (A) come due; a bucket-C card waits until day 4 — matching the
   existing `bucketsTestedOnDay` preview already shown in Settings.
2. **Calendar-anchored.** The child's position advances with the real calendar. We store a
   `cycle_start_date` (= `realToday − N`); the "current cycle day" is
   `daysBetween(cycle_start_date, realToday)`, so tomorrow the child is on day N+1 automatically.
3. **Buckets are preserved.** Only `next_due_on` is recomputed; `bucket_index`,
   `consecutive_passes_in_top_bucket`, `graduated_at` are untouched.

## Goal / non-goals

- Goal: "Apply day N" repositions a single child's schedule with no phantom backlog, and the
  position tracks the real calendar afterward.
- Goal: remove the read-time offset entirely so stored dates and the due check can't disagree.
- Goal: fold in the offset-at-creation fix (new cards placed at the child's current cycle day).
- Non-goal: the Leitner test harness / simulator (separate in-flight session). This spec must
  not depend on or modify `src/lib/__tests__/*`.
- Non-goal: changing bucket promotion/fail/graduation logic (`applyReview`) or `owedReviews`.
- Non-goal: a UI redesign of Settings beyond relabeling the existing control.

## Data model

Replace `children.day_offset int` with `children.cycle_start_date date NULL`.

- `null` ⇒ fresh start; treated as "cycle started today" (current cycle day = 0).
- Migration `supabase/migrations/0005_child_cycle_start.sql`:
  - `add column cycle_start_date date` (nullable).
  - Backfill: `cycle_start_date = current_date - day_offset` for rows with `day_offset > 0`;
    leave `null` where `day_offset = 0`.
  - `drop column day_offset`.
  - (Backfill uses the DB's `current_date`. Acceptable: only migrating-in children have a
    non-zero offset and exact day-boundary precision here is not load-bearing.)
- `Child` type ([domain.ts](../../../src/types/domain.ts)): `day_offset: number` →
  `cycle_start_date: string | null`.
- `CHILD_COLS` in [supabase.ts](../../../src/lib/db/supabase.ts) and the seed children in
  [mock.ts](../../../src/lib/db/mock.ts) updated to the new column.
- [add-child.tsx](../../../src/app/add-child.tsx) creates children with
  `cycle_start_date: null` instead of `day_offset: 0`.

## Pure scheduling additions ([leitner.ts](../../../src/lib/leitner.ts))

Keep these pure (no I/O, no React), consistent with the file's contract.

```
// Current cycle day for a child, from their stored cycle start (null ⇒ 0).
cycleDayOf(cycleStart: string | null, realToday: string): number
  = cycleStart ? Math.max(0, daysBetween(cycleStart, realToday)) : 0

// next_due_on for a bucket-i card when the child is on cycle day N, with NO backlog:
// the soonest day >= today the idealized fresh-start cycle tests bucket i.
dueDateForCycleDay(today: string, cycleDay: number, bucketIndex: number, intervals: number[]): string
```

`dueDateForCycleDay` contract (let `v = intervals[bucketIndex] ?? 1`, `N = cycleDay`):

- **Day 0 (`N <= 0`)** = fresh start, identical to `initialDueDate`: bucket A (0) due `today`;
  any higher bucket due `today + v`.
- **N ≥ 1:** let `M` = the smallest positive multiple of `v` with `M >= N`
  (`M = Math.ceil(N / v) * v`). Return `addDays(today, M - N)`.
  - If `v | N`, then `M = N` ⇒ due **today** (owes 1).
  - Else due `today + (M - N)` (in the future; not due yet).
  - Bucket A (`v = 1`) ⇒ always `M = N` ⇒ due today for all N ≥ 1.

This reproduces `bucketsTestedOnDay(N, intervals)` exactly for the "is it due today" question,
and never produces a past date (so `owedReviews` returns 1, never a backlog).

## The reposition operation (db layer)

Add to the `DB` interface and both implementations
([supabase.ts](../../../src/lib/db/supabase.ts), [mock.ts](../../../src/lib/db/mock.ts)):

```
applyCycleDay(childId: string, cycleDay: number, realToday: string): Promise<Child>
```

Steps:
1. Compute `cycle_start_date = addDays(realToday, -cycleDay)` (or `null` when `cycleDay === 0`).
2. Persist it on the child (`updateChild`-style write), and read back the updated child.
3. For every `card_state` of `childId`, look up its deck's `bucket_intervals_days` and set
   `next_due_on = dueDateForCycleDay(realToday, cycleDay, bucket_index, intervals)`. Leave
   bucket/passes/graduated untouched. Write the updated states.
4. Return the updated child.

Notes:
- Supabase: fetch the child's states joined to their deck intervals, recompute in JS, write
  back (`upsert` on `child_id,card_id`, or per-row `update`). Mock: mutate the in-memory
  `states` array the same way.
- Graduated cards (`graduated_at != null`): leave `next_due_on` as-is — they owe 0 regardless,
  and repositioning a graduated card's date is meaningless. (Recompute is harmless but skipped
  for clarity.)

## Read path: drop the offset

Replace `getEffectiveToday(tz, child.day_offset)` with the real calendar day in tz everywhere
it feeds a due query:

- [home.tsx:25](../../../src/app/(app)/home.tsx), [index.tsx:40](../../../src/app/index.tsx),
  [review.tsx:49](../../../src/app/(app)/review.tsx) → use `todayInTz(tz)` (real today).
- `getEffectiveToday` in [today.ts](../../../src/lib/today.ts): its `dayOffset` parameter is
  now unused by callers. Simplify to `getEffectiveToday(tz) = todayInTz(tz)` (or remove the
  module and call `todayInTz` directly). Keep one obvious "today in tz" entry point.

Due check itself is unchanged: `next_due_on <= realToday`, not graduated, deck still assigned
([supabase listDueCardStatesForChild](../../../src/lib/db/supabase.ts),
[mock](../../../src/lib/db/mock.ts)).

## Creation paths (fold in the offset-at-creation fix)

When a new card_state is created for a child, place it at the child's **current** cycle day
instead of always real-today:

- `createCard` / `assignDeckToChild` ([supabase.ts](../../../src/lib/db/supabase.ts),
  [mock.ts](../../../src/lib/db/mock.ts)): new cards enter at bucket 0. With
  `dueDateForCycleDay(realToday, cycleDayOf(child.cycle_start_date, realToday), 0, intervals)`
  a bucket-0 card is due `realToday` for any cycle day ≥ 1 (and on day 0). In practice bucket-A
  placement is `realToday` either way, so these paths can keep `next_due_on = realToday` — the
  bug they had only existed because **reads** added the offset, which we are removing. Document
  this; no functional change needed for the bucket-0 case once the read offset is gone.
- Import / deck-editor paths that place cards into a chosen non-zero bucket
  ([import.tsx](../../../src/app/(app)/decks/import.tsx), [decks/[id].tsx](../../../src/app/(app)/decks/[id].tsx)):
  replace `initialDueDate(getEffectiveToday('UTC', child.day_offset), bucket, intervals)` with
  `dueDateForCycleDay(realToday, cycleDayOf(child.cycle_start_date, realToday), bucket, intervals)`
  so a card seeded into bucket C on day 3 lands on day 4, not "today + interval".

## Settings UI ([settings.tsx](../../../src/app/(app)/settings.tsx))

- `applyDayOffset` → `applyCycleDay(child.id, parsedDay, realToday)`; on success `setChild`
  with the returned child and show "Now positioned at day N (X cards rescheduled)."
- `resetDayOffset` → `applyCycleDay(child.id, 0, realToday)` (clears to fresh start, reschedules).
- `appliedDay` display: `cycleDayOf(child.cycle_start_date, realToday)` instead of
  `child.day_offset`. Drop the now-meaningless "Effective today" line (it always equals real
  today now), or relabel to show `cycle_start_date`.
- Keep the `bucketsTestedOnDay` preview — it already describes exactly what the reposition does.

## Edge cases

- **Resync overwrites per-card due drift.** All same-bucket cards snap to the idealized cycle
  position. This is intended for the migrate/position use case (the user approved it). It does
  not change buckets, only due dates.
- **Day 0 framing.** `dueDateForCycleDay(..., 0, ...)` mirrors `initialDueDate` (bucket A due
  today), resolving the long-standing day-0 vs `bucketsTestedOnDay(0)=[]` inconsistency in favor
  of "fresh bucket-A cards are due on day 0."
- **Custom intervals.** Decks may set non-default intervals; `dueDateForCycleDay` takes the
  deck's `intervals`, so per-deck cards reposition against their own schedule.
- **Negative / non-integer input.** Settings already rejects `< 0` and non-integers; unchanged.

## Testing

Manual / product-code verification only (the automated harness is a separate session and this
spec must not touch `src/lib/__tests__/*`):

- Mock DB walkthrough: seed a child with cards across buckets, call `applyCycleDay(_, 3, today)`,
  assert via `listDueCardStatesForChild(child, today)` that only bucket-A cards are due and each
  owes 1 (no backlog); a bucket-C card is due after `applyCycleDay(_, 4, today)`.
- Confirm `dueDateForCycleDay` never returns a past date and equals `initialDueDate` at day 0.
- Confirm the home/profile screens compare against real today and show the repositioned counts.

## Out of scope / follow-ups

- Test-harness coverage of `dueDateForCycleDay` / `applyCycleDay` (belongs to the harness session).
- Any change to backlog handling in the review runner.
```
