# Cycle-Day Reposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-child "what day am I on" control reposition that child's schedule (rewrite each card's `next_due_on`, no backlog), calendar-anchored via a `cycle_start_date`, replacing the read-time `day_offset` that caused every card to dump due.

**Architecture:** Add two pure functions to `leitner.ts` (`cycleDayOf`, `dueDateForCycleDay`). Replace `children.day_offset` with `children.cycle_start_date`. Add a `db.applyCycleDay` op that writes the start date and rewrites every one of the child's `next_due_on` via `dueDateForCycleDay`. Drop the offset from all read paths so due is compared against the real calendar day. Place cards seeded into non-zero buckets at their cycle-day position too.

**Tech Stack:** TypeScript, Expo SDK 56, React Native, Supabase (prod) + in-memory mock (dev). No test framework on `main` — see Global Constraints.

## Global Constraints

- **Expo SDK 56** — read versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing component code (per `AGENTS.md`).
- **No test infra on `main`.** Vitest config/scripts/tests live on another branch and are out of scope. **Do NOT create or modify anything under `src/lib/__tests__/`.** Automated coverage of these functions is a follow-up owned by the test-harness session.
- **Verification toolkit (what exists on `main`):**
  - Pure-function behavioral checks: `node --experimental-strip-types <script.ts>` (Node v24). A throwaway script may `import` from `'/home/aweng/flashy/src/lib/leitner.ts'` by absolute path because `leitner.ts` has only type-only `@/` imports (erased at runtime). Put throwaway scripts in the scratchpad, run, then delete.
  - Integration gate: `npx tsc --noEmit` (baseline is currently GREEN — exit 0) and `npm run lint` (`expo lint`).
- **Dates** are `YYYY-MM-DD` strings in UTC-midnight space (`addDays`, `daysBetween`). Never introduce `Date`-local math into scheduling code.
- **Buckets** 0-indexed A=0…E=4. Default intervals `[1,2,4,8,16]`. Decks may set custom intervals — always pass the deck's own `bucket_intervals_days`.
- **`leitner.ts` stays pure** — no React, no I/O (its header contract).
- Reference spec: `docs/superpowers/specs/2026-06-28-cycle-day-reposition-design.md`.

---

## File Structure

- Modify `src/lib/leitner.ts` — add `cycleDayOf`, `dueDateForCycleDay` (pure).
- Modify `src/lib/today.ts` — simplify `getEffectiveToday` to drop the offset param.
- Modify `src/types/domain.ts` — `Child.day_offset` → `Child.cycle_start_date`.
- Create `supabase/migrations/0005_child_cycle_start.sql` — column swap + backfill.
- Modify `src/lib/db/types.ts` — add `applyCycleDay` to the `DB` interface.
- Modify `src/lib/db/mock.ts` — seed column, `applyCycleDay` impl.
- Modify `src/lib/db/supabase.ts` — `CHILD_COLS`, `applyCycleDay` impl.
- Modify `src/app/add-child.tsx` — create with `cycle_start_date: null`.
- Modify `src/app/(app)/home.tsx`, `src/app/index.tsx`, `src/app/(app)/review.tsx` — reads drop the offset.
- Modify `src/app/(app)/settings.tsx` — wire the control to `applyCycleDay`; show current cycle day.
- Modify `src/app/(app)/decks/import.tsx`, `src/app/(app)/decks/[id].tsx` — bucket placement at cycle day.

---

## Task 1: Pure scheduling functions

**Files:**
- Modify: `src/lib/leitner.ts` (append after `initialDueDate`, ~line 64)
- Verify (throwaway, deleted): `…/scratchpad/verify-cycle.ts`

**Interfaces:**
- Consumes: `addDays`, `daysBetween` (already in `leitner.ts`).
- Produces:
  - `cycleDayOf(cycleStart: string | null, realToday: string): number`
  - `dueDateForCycleDay(today: string, cycleDay: number, bucketIndex: number, intervals: number[]): string`

- [ ] **Step 1: Write the behavioral verification script (expect failure first)**

Create `/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-cycle.ts`:

```ts
import {
  addDays,
  cycleDayOf,
  dueDateForCycleDay,
  DEFAULT_BUCKET_INTERVALS as IV,
} from '/home/aweng/flashy/src/lib/leitner.ts';

const T = '2026-01-01';
let failed = 0;
const eq = (label: string, got: string, want: string) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${got} want ${want}`);
};

// Bucket A (interval 1) is due today on day 0 and every day N>=1.
eq('A day0', dueDateForCycleDay(T, 0, 0, IV), '2026-01-01');
eq('A day3', dueDateForCycleDay(T, 3, 0, IV), '2026-01-01');
// Bucket C (interval 4): day0 placed one interval out; day3 NOT due (today+1); day4 due; day5 -> +3.
eq('C day0', dueDateForCycleDay(T, 0, 2, IV), '2026-01-05');
eq('C day3', dueDateForCycleDay(T, 3, 2, IV), '2026-01-02');
eq('C day4', dueDateForCycleDay(T, 4, 2, IV), '2026-01-01');
eq('C day5', dueDateForCycleDay(T, 5, 2, IV), '2026-01-04');
// Bucket B (interval 2): day1 -> today+1 (not due), day2 -> due.
eq('B day1', dueDateForCycleDay(T, 1, 1, IV), '2026-01-02');
eq('B day2', dueDateForCycleDay(T, 2, 1, IV), '2026-01-01');
// Never a past date even far into the cycle.
eq('A day99', dueDateForCycleDay(T, 99, 0, IV), '2026-01-01');
// cycleDayOf: null -> 0; future start clamps to 0; N days ago -> N.
eq('cycleDayOf null', String(cycleDayOf(null, T)), '0');
eq('cycleDayOf future', String(cycleDayOf(addDays(T, 5), T)), '0');
eq('cycleDayOf 5', String(cycleDayOf(addDays(T, -5), T)), '5');

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails (functions not defined yet)**

Run: `node --experimental-strip-types "/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-cycle.ts"`
Expected: FAIL — `SyntaxError`/`does not provide an export named 'cycleDayOf'` (the functions don't exist yet). The `MODULE_TYPELESS_PACKAGE_JSON` warning is harmless.

- [ ] **Step 3: Add the two functions to `src/lib/leitner.ts`**

Insert immediately after the `initialDueDate` function (after line ~64, before `owedReviews`):

```ts
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
```

- [ ] **Step 4: Run the verification script to confirm it passes**

Run: `node --experimental-strip-types "/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-cycle.ts"`
Expected: every line `PASS`, final line `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no errors).

- [ ] **Step 6: Delete the throwaway script and commit**

```bash
rm "/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-cycle.ts"
git add src/lib/leitner.ts
git commit -m "Add cycleDayOf and dueDateForCycleDay scheduling helpers"
```

---

## Task 2: Swap to cycle_start_date and reposition end-to-end

This is one atomic task: changing `Child.day_offset` → `Child.cycle_start_date` breaks every
consumer at compile time, so the migration, type, DB layer, read paths, and Settings UI must
land together to keep `tsc` green. Steps are grouped; verify only at Step N (tsc/lint) and the
manual smoke.

**Files:**
- Create: `supabase/migrations/0005_child_cycle_start.sql`
- Modify: `src/types/domain.ts`, `src/lib/today.ts`, `src/lib/db/types.ts`,
  `src/lib/db/mock.ts`, `src/lib/db/supabase.ts`, `src/app/add-child.tsx`,
  `src/app/(app)/home.tsx`, `src/app/index.tsx`, `src/app/(app)/review.tsx`,
  `src/app/(app)/settings.tsx`, `src/app/(app)/decks/import.tsx`, `src/app/(app)/decks/[id].tsx`

**Interfaces:**
- Consumes: `cycleDayOf`, `dueDateForCycleDay`, `addDays` from `@/lib/leitner` (Task 1).
- Produces:
  - `Child.cycle_start_date: string | null` (replaces `day_offset: number`)
  - `DB.applyCycleDay(childId: string, cycleDay: number, realToday: string): Promise<Child>`
  - `getEffectiveToday(timezone?: string): string` (offset param removed)

- [ ] **Step 1: Create the migration**

`supabase/migrations/0005_child_cycle_start.sql`:

```sql
-- Replace the read-time `day_offset` with a calendar-anchored cycle start date.
-- "What day am I on" now repositions a child's schedule (rewrites every card's
-- next_due_on via dueDateForCycleDay) instead of sliding a comparison threshold.
-- A child's current cycle day is derived as (current_date - cycle_start_date);
-- NULL means a fresh start (day 0).
alter table children add column cycle_start_date date;

-- Preserve any in-flight migrated children: a child on day N started N days ago.
update children
  set cycle_start_date = current_date - day_offset
  where day_offset > 0;

alter table children drop column day_offset;
```

- [ ] **Step 2: Update the `Child` type**

In `src/types/domain.ts`, replace the `day_offset` field (lines 15-17) with:

```ts
  // Calendar date treated as day 0 of this child's Leitner cycle (null ⇒ fresh
  // start / day 0). Current cycle day = daysBetween(cycle_start_date, realToday).
  // Set by the "what day am I on" control, which also rewrites next_due_on.
  cycle_start_date: string | null;
```

- [ ] **Step 3: Simplify `getEffectiveToday`**

Replace the whole body of `src/lib/today.ts` with:

```ts
// "Today" for a child, in the parent's timezone. Repositioning a child's schedule
// now rewrites their card due dates (see dueDateForCycleDay), so reads compare
// against the real calendar day — there is no longer a per-child read-time offset.

import { todayInTz } from './leitner';

export function getEffectiveToday(timezone: string = 'UTC'): string {
  return todayInTz(timezone);
}
```

- [ ] **Step 4: Add `applyCycleDay` to the DB interface**

In `src/lib/db/types.ts`, add inside the `DB` interface (after `resetTodaysReviewsForChild`, before the closing brace):

```ts
  // Reposition a child onto cycle day `cycleDay`: persist cycle_start_date
  // (= realToday − cycleDay, or null for day 0) and rewrite every non-graduated
  // card_state's next_due_on via dueDateForCycleDay (no backlog). Returns the
  // updated child. `realToday` is the real calendar day in the parent's timezone.
  applyCycleDay(childId: string, cycleDay: number, realToday: string): Promise<Child>;
```

- [ ] **Step 5: Update the mock DB**

In `src/lib/db/mock.ts`:

(a) Add `dueDateForCycleDay` to the leitner import (line 4):

```ts
import { addDays, dueDateForCycleDay, todayInTz } from '@/lib/leitner';
```

(b) Replace the two seed children (lines 19-20) so they use the new column:

```ts
  { id: 'c1', parent_id: 'p1', display_name: 'Mira', avatar: '🦊', graduate_after_passes: null, cycle_start_date: null },
  { id: 'c2', parent_id: 'p1', display_name: 'Eli', avatar: '🐻', graduate_after_passes: 3, cycle_start_date: null },
```

(c) Add the `applyCycleDay` method (insert after `updateChild`, before `deleteChild`, ~line 128):

```ts
  async applyCycleDay(childId, cycleDay, realToday) {
    const idx = children.findIndex((c) => c.id === childId);
    if (idx < 0) throw new Error('Child not found');
    const cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay);
    children[idx] = { ...children[idx], cycle_start_date };
    // Reschedule every non-graduated card_state against its deck's intervals.
    for (const s of states) {
      if (s.child_id !== childId || s.graduated_at) continue;
      const card = cards.find((c) => c.id === s.card_id);
      const deck = card ? decks.find((d) => d.id === card.deck_id) : undefined;
      if (!deck) continue;
      s.next_due_on = dueDateForCycleDay(
        realToday, cycleDay, s.bucket_index, deck.bucket_intervals_days,
      );
    }
    return children[idx];
  },
```

Note: `createCard` and `assignDeckToChild` need NO change — they create bucket-0 states with
`next_due_on = getEffectiveToday()` (= real today), which is correct for bucket 0 at any cycle
day. Their old bug was purely on the read side, now removed.

- [ ] **Step 6: Update the Supabase DB**

In `src/lib/db/supabase.ts`:

(a) Add `dueDateForCycleDay` to the leitner import (line 6):

```ts
import { addDays, dueDateForCycleDay, todayInTz } from '@/lib/leitner';
```

(b) Swap the column list (line 12):

```ts
const CHILD_COLS = 'id, parent_id, display_name, avatar, graduate_after_passes, cycle_start_date';
```

(c) Add the `applyCycleDay` method (insert after `updateChild`, before `deleteChild`, ~line 70):

```ts
  async applyCycleDay(childId, cycleDay, realToday): Promise<Child> {
    const cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay);
    const { data: childRow, error: cErr } = await supabase
      .from('children')
      .update({ cycle_start_date })
      .eq('id', childId)
      .select(CHILD_COLS)
      .single();
    if (cErr) throw cErr;

    // Pull this child's non-graduated states joined to their deck intervals,
    // recompute next_due_on, and write each back.
    const { data: rows, error: sErr } = await supabase
      .from('card_states')
      .select('child_id, card_id, bucket_index, card:cards!inner(deck:decks!inner(bucket_intervals_days))')
      .eq('child_id', childId)
      .is('graduated_at', null);
    if (sErr) throw sErr;

    type Row = {
      child_id: string;
      card_id: string;
      bucket_index: number;
      card: { deck: { bucket_intervals_days: number[] } };
    };
    for (const r of (rows as unknown as Row[]) ?? []) {
      const next_due_on = dueDateForCycleDay(
        realToday, cycleDay, r.bucket_index, r.card.deck.bucket_intervals_days,
      );
      const { error: uErr } = await supabase
        .from('card_states')
        .update({ next_due_on })
        .eq('child_id', r.child_id)
        .eq('card_id', r.card_id);
      if (uErr) throw uErr;
    }
    return childRow as Child;
  },
```

- [ ] **Step 7: Update `add-child.tsx`**

In `src/app/add-child.tsx`, change the `createChild` payload (line 37):

```ts
        cycle_start_date: null,
```

(replacing `day_offset: 0,`).

- [ ] **Step 8: Drop the offset from the three read screens**

`src/app/(app)/home.tsx` line 25:

```ts
      const today = getEffectiveToday(parent?.timezone ?? 'UTC');
```

`src/app/index.tsx` line 40 — change the due-count call:

```ts
              .countDueCardsForChild(c.id, getEffectiveToday(parent.timezone))
```

`src/app/(app)/review.tsx` line 49:

```ts
      const _today = getEffectiveToday(tz);
```

- [ ] **Step 9: Rewire Settings to reposition**

In `src/app/(app)/settings.tsx`:

(a) Add `cycleDayOf` to the leitner import (lines 13-18 block):

```ts
import {
  applyReview,
  bucketLetter,
  bucketsTestedOnDay,
  cycleDayOf,
  DEFAULT_BUCKET_INTERVALS,
} from '@/lib/leitner';
```

(b) Replace the seed of `dayInput` in the `useEffect` (line 64):

```ts
    setDayInput(String(cycleDayOf(child.cycle_start_date, getEffectiveToday('UTC'))));
```

(c) Replace the `appliedDay` / `effectiveToday` derivations (lines 69-70):

```ts
  const appliedDay = cycleDayOf(child.cycle_start_date, getEffectiveToday('UTC'));
```

(remove the `effectiveToday` line entirely).

(d) Replace the `applyDayOffset` function (lines 105-122):

```ts
  async function applyDayOffset() {
    if (!child) return;
    setDayError(null);
    setDayFeedback(null);
    const parsed = parseInt(dayInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDayError('Day must be a non-negative integer.');
      return;
    }
    try {
      const parent = await db.getCurrentParent();
      const realToday = getEffectiveToday(parent?.timezone ?? 'UTC');
      const updated = await db.applyCycleDay(child.id, parsed, realToday);
      setChild(updated);
      setDayFeedback(parsed === 0 ? 'Reset to a fresh start (day 0).' : `Repositioned to day ${parsed}.`);
      setTimeout(() => setDayFeedback(null), 2000);
    } catch (e) {
      setDayError(e instanceof Error ? e.message : 'Could not save.');
    }
  }
```

(e) Replace the `resetDayOffset` function (lines 124-135):

```ts
  async function resetDayOffset() {
    if (!child) return;
    setDayInput('0');
    try {
      const parent = await db.getCurrentParent();
      const realToday = getEffectiveToday(parent?.timezone ?? 'UTC');
      const updated = await db.applyCycleDay(child.id, 0, realToday);
      setChild(updated);
      setDayFeedback('Reset to a fresh start (day 0).');
      setTimeout(() => setDayFeedback(null), 2000);
    } catch (e) {
      setDayError(e instanceof Error ? e.message : 'Could not save.');
    }
  }
```

(f) Replace the "Applied / Effective today" line (lines 354-356) with just the current day:

```ts
            <ThemedText themeColor="textSecondary" type="small">
              Currently on day {appliedDay}.
            </ThemedText>
```

- [ ] **Step 10: Place bucket-seeded cards at the cycle day (import + deck editor)**

`src/app/(app)/decks/import.tsx` — replace lines 96-103 (the `today` + `initialDueDate` placement). First ensure `cycleDayOf` and `dueDateForCycleDay` are imported from `@/lib/leitner` (the file already imports `initialDueDate`; add the two and drop `initialDueDate` if it becomes unused), and `getEffectiveToday` stays imported:

```ts
        const realToday = getEffectiveToday('UTC');
        const cycleDay = cycleDayOf(child.cycle_start_date, realToday);
        for (const c of created) {
          if (c.bucket === undefined) continue;
          await db.upsertCardState({
            child_id: child.id,
            card_id: c.id,
            bucket_index: c.bucket,
            next_due_on: dueDateForCycleDay(realToday, cycleDay, c.bucket, deck.bucket_intervals_days),
            consecutive_passes_in_top_bucket: 0,
            graduated_at: null,
            last_reviewed_at: null,
          });
        }
```

`src/app/(app)/decks/[id].tsx` has **two** placement blocks — fix both. Ensure `cycleDayOf`, `dueDateForCycleDay` are imported from `@/lib/leitner`.

Block 1 — the add-card handler (lines 104 + 109):

```ts
        const realToday = getEffectiveToday('UTC');
        const cycleDay = cycleDayOf(currentChild.cycle_start_date, realToday);
        await db.upsertCardState({
          child_id: currentChild.id,
          card_id: created.id,
          bucket_index: addBucket,
          next_due_on: dueDateForCycleDay(realToday, cycleDay, addBucket, deck.bucket_intervals_days),
          consecutive_passes_in_top_bucket: 0,
          graduated_at: null,
          last_reviewed_at: null,
        });
```

Block 2 — the `setBucket` handler (lines 193 + 198). Note it preserves `existing?.last_reviewed_at`:

```ts
    const realToday = getEffectiveToday('UTC');
    const cycleDay = cycleDayOf(currentChild.cycle_start_date, realToday);
    const newState: CardState = {
      child_id: currentChild.id,
      card_id: cardId,
      bucket_index: bucketIndex,
      next_due_on: dueDateForCycleDay(realToday, cycleDay, bucketIndex, deck.bucket_intervals_days),
      consecutive_passes_in_top_bucket: 0,
      graduated_at: null,
      last_reviewed_at: existing?.last_reviewed_at ?? null,
    };
```

If `initialDueDate` is now unused in either file, remove it from that file's import to satisfy lint.

- [ ] **Step 11: Typecheck the whole change**

Run: `npx tsc --noEmit`
Expected: exit 0. (Common misses: a leftover `child.day_offset` reference, a `getEffectiveToday(x, y)` two-arg call, or an unused `initialDueDate`/`getEffectiveToday` import.)

- [ ] **Step 12: Lint**

Run: `npm run lint`
Expected: no errors. Remove any now-unused imports it flags (`initialDueDate`, `owedReviews` only if it became unused — it is still used in `review.tsx`, so keep it there).

- [ ] **Step 13: Manual smoke (mock DB)**

Confirm which DB is active in `src/lib/db/index.ts`. If it's the mock, run the app and check the
reposition behavior; if Supabase, apply the migration to your dev project first
(`supabase db push` or equivalent) and verify there.

Run: `npm run web` (or `npm start`), then for a child with a freshly-seeded deck:
- Settings → set Day to `3`, Apply. Expect: only bucket-A cards are due now (Home shows them, 1 review each — no inflated counts); bucket-C cards are not yet due.
- Settings → set Day to `4`, Apply. Expect: bucket-C cards become due.
- Settings → Reset. Expect: back to fresh-start placement (bucket A due today; higher buckets one interval out).
- Switch to a different child. Expect: their due counts are unchanged by the first child's repositioning (per-child).

Expected: matches the above. If anything diverges, STOP and report before committing.

- [ ] **Step 14: Commit**

```bash
git add supabase/migrations/0005_child_cycle_start.sql src/types/domain.ts src/lib/today.ts \
  src/lib/db/types.ts src/lib/db/mock.ts src/lib/db/supabase.ts src/app/add-child.tsx \
  "src/app/(app)/home.tsx" src/app/index.tsx "src/app/(app)/review.tsx" \
  "src/app/(app)/settings.tsx" "src/app/(app)/decks/import.tsx" "src/app/(app)/decks/[id].tsx"
git commit -m "Reposition child schedule on 'what day am I on' instead of sliding a read-time offset"
```

---

## Self-Review

**Spec coverage:**
- Data model (`cycle_start_date` replaces `day_offset`, migration 0005, `Child` type) → Task 2 Steps 1, 2, 7; mock/supabase cols Steps 5b, 6b. ✓
- `cycleDayOf` + `dueDateForCycleDay` pure fns with day-0 = `initialDueDate` parity and no past dates → Task 1. ✓
- `applyCycleDay` reposition op (writes start date + rewrites non-graduated `next_due_on`, preserves buckets) → Task 2 Steps 4, 5c, 6c. ✓
- Read path drops the offset (home/index/review + `getEffectiveToday` simplification) → Steps 3, 8. ✓
- Settings rewired to `applyCycleDay`, shows current cycle day, keeps `bucketsTestedOnDay` preview → Step 9. ✓
- Creation paths: `createCard`/`assignDeckToChild` unchanged (bucket-0 = real today; documented in Step 5); import/deck-editor placement at cycle day → Step 10. ✓
- Per-child isolation, day-0 framing, custom intervals → covered by the functions + manual smoke Step 13. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. Manual smoke (Step 13) gives concrete expected outcomes, not "verify it works." ✓

**Type consistency:** `applyCycleDay(childId, cycleDay, realToday): Promise<Child>` identical in the interface (4) and both impls (5c, 6c). `dueDateForCycleDay(today, cycleDay, bucketIndex, intervals)` and `cycleDayOf(cycleStart, realToday)` used with matching arg order/types everywhere (Task 1 def; Steps 5c, 6c, 9, 10). `getEffectiveToday(timezone?)` single-arg at every call site after Step 3. `Child.cycle_start_date: string | null` consumed as such in `cycleDayOf` calls. ✓
```
