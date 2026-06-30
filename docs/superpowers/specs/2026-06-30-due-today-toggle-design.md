# "Due today" toggle on deck-manager cards

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Problem

In the deck manager ([src/app/(app)/decks/[id].tsx](../../../src/app/(app)/decks/[id].tsx)), a parent can change a card's bucket but cannot directly flag a card as "due today." There is no quick way to simulate either:

- a card that was due earlier but got **skipped**, so it should still be flagged as due, or
- a card in a bucket due to test today but that was **missed and added post-hoc**.

Both scenarios collapse to the same effect: the card should appear in today's review queue with exactly one review owed.

## Solution overview

Add a tappable **"Due today"** chip to each card row in the deck manager. It reads and writes the existing `CardState.next_due_on` field — **no schema change**.

A card is "due" iff `!graduated_at && next_due_on <= realToday` (matches `owedReviews` / the review-queue filter `lte('next_due_on', today)` in [supabase.ts](../../../src/lib/db/supabase.ts)).

Tapping the chip flips `next_due_on`:

| Current state | Tap result | New `next_due_on` |
|---|---|---|
| Not due | Force due today | `realToday` (→ 1 review owed) |
| Due | Return to natural schedule | `dueDateForCycleDay(realToday, cycleDay, bucket_index, intervals)` |

The "return to schedule" path reuses the exact logic already used when changing a card's bucket (`setBucket`), so behavior is consistent with the rest of the app. (Per the brainstorm: chosen over a "push one interval" alternative.)

## Components

### 1. Pure helper — `isDueOn` (`src/lib/leitner.ts`)

```ts
// True iff the card owes a review on `today` (due today or overdue) and isn't graduated.
export function isDueOn(state: CardState, today: string): boolean {
  return !state.graduated_at && state.next_due_on <= today;
}
```

String comparison is valid because dates are ISO `YYYY-MM-DD`. Keeps due-ness logic pure and testable, and decouples the chip from `owedReviews` (which needs a `deck` arg just to compute a backlog count we don't need here).

### 2. Handler — `toggleDue(card)` (`src/app/(app)/decks/[id].tsx`)

Mirrors the existing `setBucket`:

1. Guard on `currentChild && deck`; read `existing = cardStates.get(card.id)`; bail if none.
2. `realToday = getEffectiveToday('UTC')` and `cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday)` (fetch assignment the same way `setBucket` does).
3. Compute new due date:
   - currently due → `dueDateForCycleDay(realToday, cycleDay, existing.bucket_index, deck.bucket_intervals_days)`
   - currently not due → `realToday`
4. Build `newState` = `{ ...existing, next_due_on }` — `bucket_index`, `consecutive_passes_in_top_bucket`, `graduated_at`, `last_reviewed_at` all unchanged.
5. `await db.upsertCardState(newState)` and update the local `cardStates` map (same immutable `new Map` pattern as `setBucket`).

### 3. UI — chip in `rowActions`

- Rendered immediately left of the existing Bucket chip, gated on `currentChild && cardStates.has(card.id) && !cardStates.get(card.id)!.graduated_at`.
- Label: "Due today".
- Style: filled (reuse the blue `bucketBtnActive` look) when `isDueOn(state, realToday)` is true; outline (like `bucketChip`) when false.
- `onPress={() => toggleDue(card)}`.

`realToday` is already computed once in the render body (`getEffectiveToday(scheduleTz)`); reuse it for the chip's visual state.

## Data flow

User taps chip → `toggleDue` → `db.upsertCardState` (persists new `next_due_on`) → local `cardStates` map updated → row re-renders with flipped chip style. On next visit to the review/home screen, `owedReviews` / the due query picks the card up (or drops it) accordingly.

## Edge cases

- **Graduated cards:** chip hidden. Forcing `next_due_on` on a graduated card is a no-op anyway — the review queue filters `graduated_at is null`.
- **Toggle OFF still due:** if the card's bucket is naturally tested on the current cycle day, `dueDateForCycleDay` returns `realToday`, so it stays due. Expected — that is the real schedule.
- **No child selected / no card state:** chip not shown (due-ness is per-child state), consistent with the Bucket chip.

## Testing / verification

No test framework in this project. Verify with:

- `npx tsc --noEmit` (typecheck)
- `npm run lint`
- Manual: with a child selected, tap the chip on a not-due card → it fills and the card appears in today's review; tap again → it returns to schedule.

## Out of scope

- Backlog simulation (multiple reviews owed via backdating). Forcing due sets exactly one owed review.
- Any change to the review screen, home screen, or scheduling math.
