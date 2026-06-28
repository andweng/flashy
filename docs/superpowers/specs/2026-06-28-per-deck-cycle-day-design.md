# Per-deck-per-child cycle day + deck-aware preview — design

Date: 2026-06-28
Status: approved (brainstorm)

## Problem

The "what day am I on" cycle anchor we just shipped is **per child**
(`children.cycle_start_date`, see
[2026-06-28-cycle-day-reposition-design.md](2026-06-28-cycle-day-reposition-design.md)).
But a child works multiple decks, each with its own intervals and its own point in the
cycle. The anchor should be **per (child, deck)**. Relatedly, the Settings preview shows
which buckets a *generic* standard-Leitner schedule (`bucketsTestedOnDay` over
`DEFAULT_BUCKET_INTERVALS`) would test on day N — it should instead show **what is due in
this child's actual deck**: this deck's intervals applied to the child's real cards.

## Decisions (from brainstorm)

1. **Granularity: per-(child, deck) only.** Move the cycle anchor onto `deck_assignments`;
   drop `children.cycle_start_date`. No per-child fallback layer.
2. **Control location: the deck detail screen,** scoped to the current child. Remove the
   per-child "Schedule" section from Settings.
3. **Preview: the child's actual cards in this deck, grouped.** For an entered day N, using
   this deck's intervals, tally which buckets have cards that would be due and how many.

This is a **relocation** of the per-child reposition feature down to per-(child, deck) plus a
smarter preview — the core scheduling logic (`cycleDayOf`, `dueDateForCycleDay`,
write-order-hardened reposition) is unchanged.

## Goal / non-goals

- Goal: each (child, deck) pair has its own cycle anchor and "Apply day N" that reschedules
  **only that deck's cards** for that child, with no backlog (reusing `dueDateForCycleDay`).
- Goal: the deck detail screen shows the current child's current cycle day for that deck and a
  preview of which buckets/how many cards would be due on an entered day.
- Goal: card placement into non-zero buckets uses the per-(child, deck) cycle day.
- Non-goal: changing read/due semantics (reads already compare `next_due_on <= realToday`; the
  anchor never re-enters the read path).
- Non-goal: changing `cycleDayOf` / `dueDateForCycleDay` / `applyReview` / `owedReviews`.
- Non-goal: the Leitner test harness (separate session; do not touch `src/lib/__tests__/`).
- Non-goal: a per-deck schedule list in Settings or Home (control lives on the deck screen).

## Data model

Move the anchor from `children` to the assignment join.

- `deck_assignments` gains `cycle_start_date date null` (per child+deck; `null` = fresh start,
  current cycle day 0).
- Migration `supabase/migrations/0006_deck_cycle_start.sql`:
  - `alter table deck_assignments add column cycle_start_date date;`
  - Backfill from the just-shipped per-child value:
    `update deck_assignments da set cycle_start_date = c.cycle_start_date
       from children c where da.child_id = c.id and c.cycle_start_date is not null;`
  - `alter table children drop column cycle_start_date;`
- Types ([domain.ts](../../../src/types/domain.ts)): remove `Child.cycle_start_date`. Add a
  `DeckAssignment` type `{ deck_id: string; child_id: string; cycle_start_date: string | null }`
  to carry the per-pair anchor.
- `CHILD_COLS` in [supabase.ts](../../../src/lib/db/supabase.ts) drops `cycle_start_date`; the
  mock seed children drop it. `add-child.tsx` drops `cycle_start_date: null` from the create
  payload (children no longer carry it).

## DB interface + reposition op

- Replace the per-child op with a per-deck one in the `DB` interface and both impls:

  `applyCycleDay(childId: string, deckId: string, cycleDay: number, realToday: string): Promise<DeckAssignment>`

  Steps: compute `cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay)`;
  rewrite `next_due_on = dueDateForCycleDay(realToday, cycleDay, bucket_index, deck.intervals)`
  for the child's **non-graduated** card_states **in this deck only** (filter card→deck_id =
  deckId); THEN write `deck_assignments.cycle_start_date` last (write-order hardening — a
  partial failure leaves the pair on its old day, and the op is idempotent on retry); return the
  updated assignment row.
  - Mock: filter `states` by `child_id` + the deck's card ids; mutate; update the in-memory
    assignment record (extend the `assignments` array entries with `cycle_start_date`).
  - Supabase: select the child's non-graduated states joined to `cards.deck_id` and
    `decks.bucket_intervals_days`, filter to `deckId`, update each `next_due_on`, then update the
    `deck_assignments` row (`.eq('deck_id', deckId).eq('child_id', childId)`).

- Add a reader for the per-pair anchor (used by the deck screen and placement):
  `getDeckAssignment(deckId: string, childId: string): Promise<DeckAssignment | null>`
  (returns `cycle_start_date`; `null` row → not assigned). Supabase selects the
  `deck_assignments` row; mock returns the in-memory entry.

## Pure logic ([leitner.ts](../../../src/lib/leitner.ts))

- `cycleDayOf` and `dueDateForCycleDay` unchanged.
- Add the preview helper (pure):

  `dueGroupsForDeckOnDay(states: Pick<CardState,'bucket_index'|'graduated_at'|'next_due_on'>[], intervals: number[], cycleDay: number, realToday: string): { bucket: number; due: number; notDue: number }[]`

  For each non-graduated state, it is **due on day N** iff
  `dueDateForCycleDay(realToday, cycleDay, bucket_index, intervals) === realToday`. Group by
  bucket, count due vs not-due, return rows sorted by bucket index (only buckets that have at
  least one card). This reflects the child's real distribution in the deck.
- `bucketsTestedOnDay` becomes unused after the Settings preview is removed — delete it (and its
  generic-preview role).

## UI

### Deck detail screen ([decks/[id].tsx](../../../src/app/(app)/decks/[id].tsx))

Scoped to `currentChild` (the screen already loads `currentChild`, `deck`, and the child's
`cardStates` map). Hidden entirely when no current child is selected.

- Load the pair's anchor via `getDeckAssignment(deck.id, currentChild.id)`; show
  "Currently on day {cycleDayOf(anchor.cycle_start_date, realToday)}".
- A Day text input + **Apply** / **Reset** buttons → `applyCycleDay(currentChild.id, deck.id,
  parsedDay, realToday)`; on success refresh the anchor and the card states. Reuse the
  validation (non-negative integer) and feedback pattern from the old Settings control.
- **Preview** from `dueGroupsForDeckOnDay(<currentChild's states in this deck>,
  deck.bucket_intervals_days, previewDay, realToday)`, rendered as e.g.
  "Day 7 — 3 cards due: A ×2, C ×1 · not yet: B ×3". `realToday = getEffectiveToday(parentTz)`.

### Settings ([settings.tsx](../../../src/app/(app)/settings.tsx))

Remove the entire "Schedule" section: the `dayInput`/`dayError`/`dayFeedback` state, the
`applyDayOffset`/`resetDayOffset` handlers, the `appliedDay`/preview derivations, the JSX block,
and now-unused imports (`bucketsTestedOnDay`, `DEFAULT_BUCKET_INTERVALS`, `cycleDayOf`,
`getEffectiveToday` if otherwise unused — keep what the rest of the screen still needs).

### Placement paths

Card placement into a chosen non-zero bucket uses the per-(child, deck) cycle day:
- [decks/[id].tsx](../../../src/app/(app)/decks/[id].tsx) add-card and `setBucket` blocks, and
  [decks/import.tsx](../../../src/app/(app)/decks/import.tsx): compute
  `cycleDay = cycleDayOf((await getDeckAssignment(deckId, childId))?.cycle_start_date ?? null,
  realToday)` and place at `dueDateForCycleDay(realToday, cycleDay, bucket, deck.intervals)`.
- `createCard` / `assignDeckToChild` stay unchanged (bucket-0 = real today regardless of cycle
  day); a newly assigned deck starts at `cycle_start_date = null` (day 0).

## Edge cases

- **Multiple decks, different days:** each deck's `next_due_on` values are absolute and compared
  against real today; per-deck anchors never collide. Confirmed by reads being anchor-free.
- **Reposition preserves buckets** (only `next_due_on` rewritten), so the preview's bucket
  distribution is stable across an Apply.
- **Unassigned deck / no current child:** the schedule control is hidden; `getDeckAssignment`
  returns null → treated as day 0 for placement.
- **Custom intervals** flow through `deck.bucket_intervals_days` in both the reschedule and the
  preview.

## Testing

Product-code verification only (no test framework on `main`; harness is a separate session):
- `npx tsc --noEmit` (green) and `npm run lint` (clean) as the integration gates.
- Pure-function behavioral check (throwaway `node --experimental-strip-types` script, deleted
  after) for `dueGroupsForDeckOnDay`: e.g. intervals `[1,3,7,14,30]`, states A×2/B×3/C×1, day 7
  → `[{bucket:0,due:2,notDue:0},{bucket:1,due:0,notDue:3},{bucket:2,due:1,notDue:0}]`.
- Manual smoke (best-effort): on a deck, Apply day 7, confirm only the expected buckets' cards
  are due for the current child and a sibling deck/child is unaffected.

## Out of scope / follow-ups

- Optional transactional RPC for `applyCycleDay` (carried over from the per-child design).
- Test-harness coverage of the new helper and op (harness session).
