# Per-deck-per-child Cycle Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "what day am I on" cycle anchor from per-child to per-(child, deck): each deck a child works gets its own anchor and an "Apply day N" that reschedules only that deck's cards, with the control + a deck-aware preview living on the deck detail screen.

**Architecture:** Relocate the just-shipped per-child reposition feature down one level. Add a pure preview helper to `leitner.ts`. Move `cycle_start_date` from `children` to `deck_assignments`, re-scope `applyCycleDay` to `(child, deck)`, add a `getDeckAssignment` reader, remove the Settings "Schedule" section, and add the control + actual-cards preview to the deck detail screen. Reads are untouched (already compare `next_due_on <= realToday`).

**Tech Stack:** TypeScript, Expo SDK 56, React Native, Supabase (prod) + in-memory mock (dev). No test framework on `main`.

## Global Constraints

- **Expo SDK 56** — read https://docs.expo.dev/versions/v56.0.0/ before writing component code (per `AGENTS.md`).
- **No test framework on `main`.** Do NOT create or modify anything under `src/lib/__tests__/`. Verification = `npx tsc --noEmit` (baseline GREEN, exit 0) + `npm run lint` (clean), plus throwaway `node --experimental-strip-types <script.ts>` (Node v24) for pure-function checks — a script may `import` from `/home/aweng/flashy/src/lib/leitner.ts` by absolute path (type-only `@/` imports are erased at runtime). Put throwaway scripts in the scratchpad, run, delete. The `MODULE_TYPELESS_PACKAGE_JSON` node warning is harmless.
- Dates are `YYYY-MM-DD` UTC-midnight strings (`addDays`, `daysBetween`); no `Date`-local math.
- Buckets 0-indexed A=0…E=4; always pass the deck's own `bucket_intervals_days`.
- `src/lib/leitner.ts` stays pure (no React, no I/O).
- Builds depend on `package-lock.json` staying in sync — do NOT run `npm install`/`npm ci`; only `tsc`/`lint` (already-installed binaries).
- Commits sign with GPG (`commit.gpgsign=true`); a human answers the passphrase. On `gpg: signing failed: Timeout`, re-run the same `git commit`; report BLOCKED only after two consecutive failures.
- Reference spec: `docs/superpowers/specs/2026-06-28-per-deck-cycle-day-design.md`.

---

## File Structure

- Modify `src/lib/leitner.ts` — add `dueGroupsForDeckOnDay` (pure).
- Create `supabase/migrations/0006_deck_cycle_start.sql` — move the column.
- Modify `src/types/domain.ts` — remove `Child.cycle_start_date`; add `DeckAssignment`.
- Modify `src/lib/db/types.ts` — re-scope `applyCycleDay`; add `getDeckAssignment`.
- Modify `src/lib/db/mock.ts`, `src/lib/db/supabase.ts` — per-deck impls.
- Modify `src/app/add-child.tsx` — drop `cycle_start_date` from create.
- Modify `src/app/(app)/settings.tsx` — remove the Schedule section.
- Modify `src/app/(app)/decks/import.tsx`, `src/app/(app)/decks/[id].tsx` — placement uses the per-deck anchor; the deck screen gains the control + preview.

---

## Task 1: Preview helper `dueGroupsForDeckOnDay`

**Files:**
- Modify: `src/lib/leitner.ts` (append after `dueDateForCycleDay`)
- Verify (throwaway, deleted): `…/scratchpad/verify-groups.ts`

**Interfaces:**
- Consumes: `dueDateForCycleDay` (already in `leitner.ts`).
- Produces: `dueGroupsForDeckOnDay(states: { bucket_index: number; graduated_at: string | null }[], intervals: number[], cycleDay: number, realToday: string): { bucket: number; due: number; notDue: number }[]`

- [ ] **Step 1: Write the verification script (expect failure first)**

Create `/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-groups.ts`:

```ts
import { dueGroupsForDeckOnDay } from '/home/aweng/flashy/src/lib/leitner.ts';

const T = '2026-01-01';
const iv = [1, 3, 7, 14, 30];
const states = [
  { bucket_index: 0, graduated_at: null },
  { bucket_index: 0, graduated_at: null },
  { bucket_index: 1, graduated_at: null },
  { bucket_index: 1, graduated_at: null },
  { bucket_index: 1, graduated_at: null },
  { bucket_index: 2, graduated_at: null },
  { bucket_index: 2, graduated_at: '2026-01-01T00:00:00Z' }, // graduated -> ignored
];

const got = JSON.stringify(dueGroupsForDeckOnDay(states, iv, 7, T));
// Day 7: A(1|7) due x2; B(3∤7) not due x3; C(7|7) due x1; graduated C ignored.
const want = JSON.stringify([
  { bucket: 0, due: 2, notDue: 0 },
  { bucket: 1, due: 0, notDue: 3 },
  { bucket: 2, due: 1, notDue: 0 },
]);
console.log(got === want ? 'PASS' : `FAIL got ${got} want ${want}`);
process.exit(got === want ? 0 : 1);
```

- [ ] **Step 2: Run to confirm it fails (function not defined)**

Run: `node --experimental-strip-types "/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-groups.ts"`
Expected: FAIL — `does not provide an export named 'dueGroupsForDeckOnDay'`.

- [ ] **Step 3: Add the function to `src/lib/leitner.ts`**

Insert immediately after `dueDateForCycleDay`:

```ts
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
```

- [ ] **Step 4: Run the verification script to confirm PASS**

Run: `node --experimental-strip-types "/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-groups.ts"`
Expected: `PASS`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Delete the throwaway script and commit**

```bash
rm "/tmp/claude-1000/-home-aweng-flashy/c9c4e32c-d3b2-4a5f-8304-adb574eabcc7/scratchpad/verify-groups.ts"
git add src/lib/leitner.ts
git commit -m "Add dueGroupsForDeckOnDay deck-schedule preview helper"
```

---

## Task 2: Relocate the cycle anchor to per-(child, deck)

Atomic: removing `Child.cycle_start_date` and re-scoping `applyCycleDay` breaks every consumer at compile time, so the migration, types, DB layer, Settings removal, and placement updates land together. Verify at Step 12 (tsc/lint).

**Files:**
- Create: `supabase/migrations/0006_deck_cycle_start.sql`
- Modify: `src/types/domain.ts`, `src/lib/db/types.ts`, `src/lib/db/mock.ts`, `src/lib/db/supabase.ts`, `src/app/add-child.tsx`, `src/app/(app)/settings.tsx`, `src/app/(app)/decks/import.tsx`, `src/app/(app)/decks/[id].tsx`

**Interfaces:**
- Consumes: `addDays`, `dueDateForCycleDay`, `cycleDayOf` from `@/lib/leitner`.
- Produces:
  - `DeckAssignment = { deck_id: string; child_id: string; cycle_start_date: string | null }`
  - `DB.getDeckAssignment(deckId: string, childId: string): Promise<DeckAssignment | null>`
  - `DB.applyCycleDay(childId: string, deckId: string, cycleDay: number, realToday: string): Promise<DeckAssignment>` (replaces the per-child 3-arg version)
  - `Child` no longer has `cycle_start_date`.

- [ ] **Step 1: Migration**

`supabase/migrations/0006_deck_cycle_start.sql`:

```sql
-- Move the Leitner cycle anchor from per-child to per-(child, deck): each deck a
-- child works has its own "what day am I on". Replaces children.cycle_start_date
-- (added in 0005). "Apply day N" reschedules only that deck's cards for that child.
alter table deck_assignments add column cycle_start_date date;

-- Preserve any per-child anchor from the previous design: seed every one of that
-- child's deck assignments with their (single) child-level start date.
update deck_assignments da
  set cycle_start_date = c.cycle_start_date
  from children c
  where da.child_id = c.id and c.cycle_start_date is not null;

alter table children drop column cycle_start_date;
```

- [ ] **Step 2: Types — `domain.ts`**

In `src/types/domain.ts`, remove the `cycle_start_date` field (and its comment) from `Child` so it reads:

```ts
export type Child = {
  id: string;
  parent_id: string;
  display_name: string;
  avatar: string | null;
  graduate_after_passes: number | null;
};
```

Add a new type (place it right after `Child`):

```ts
// One child's enrollment in one deck. cycle_start_date is the per-(child, deck)
// Leitner anchor (null = fresh start / day 0); current cycle day =
// daysBetween(cycle_start_date, realToday).
export type DeckAssignment = {
  deck_id: string;
  child_id: string;
  cycle_start_date: string | null;
};
```

- [ ] **Step 3: DB interface — `types.ts`**

In `src/lib/db/types.ts`:

(a) Add `DeckAssignment` to the domain import:

```ts
import type { Card, CardState, Child, Deck, DeckAssignment, Parent, Review } from '@/types/domain';
```

(b) Replace the existing `applyCycleDay` line and add `getDeckAssignment`. Find:

```ts
  applyCycleDay(childId: string, cycleDay: number, realToday: string): Promise<Child>;
```

Replace with:

```ts
  getDeckAssignment(deckId: string, childId: string): Promise<DeckAssignment | null>;
  // Reposition (child, deck) onto cycle day `cycleDay`: persist
  // deck_assignments.cycle_start_date (= realToday − cycleDay, or null for day 0)
  // and rewrite next_due_on for that child's non-graduated cards IN THIS DECK via
  // dueDateForCycleDay. Returns the updated assignment. `realToday` is the real day.
  applyCycleDay(childId: string, deckId: string, cycleDay: number, realToday: string): Promise<DeckAssignment>;
```

- [ ] **Step 4: Mock — assignments carry the anchor + seed children**

In `src/lib/db/mock.ts`:

(a) Widen the `assignments` array type (line ~29) — keep the seed rows as-is (no `cycle_start_date` ⇒ `undefined` ≡ day 0):

```ts
const assignments: { deck_id: string; child_id: string; cycle_start_date?: string | null }[] = [
```

(b) Remove `cycle_start_date: null` from the two seed children (line ~19-20) so they read:

```ts
  { id: 'c1', parent_id: 'p1', display_name: 'Mira', avatar: '🦊', graduate_after_passes: null },
  { id: 'c2', parent_id: 'p1', display_name: 'Eli', avatar: '🐻', graduate_after_passes: 3 },
```

- [ ] **Step 5: Mock — replace `applyCycleDay`, add `getDeckAssignment`**

In `src/lib/db/mock.ts`, replace the whole existing `applyCycleDay` method (the `async applyCycleDay(childId, cycleDay, realToday) { … }` block) with these two methods:

```ts
  async getDeckAssignment(deckId, childId) {
    const a = assignments.find((x) => x.deck_id === deckId && x.child_id === childId);
    return a
      ? { deck_id: a.deck_id, child_id: a.child_id, cycle_start_date: a.cycle_start_date ?? null }
      : null;
  },
  async applyCycleDay(childId, deckId, cycleDay, realToday) {
    const a = assignments.find((x) => x.deck_id === deckId && x.child_id === childId);
    if (!a) throw new Error('Deck not assigned to child');
    const cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay);
    // Reschedule this child's non-graduated cards IN THIS DECK only. Rewrite the
    // card dates first; set the anchor last (write-order safe + idempotent).
    const deck = decks.find((d) => d.id === deckId);
    const deckCardIds = new Set(cards.filter((c) => c.deck_id === deckId).map((c) => c.id));
    if (deck) {
      for (const s of states) {
        if (s.child_id !== childId || s.graduated_at || !deckCardIds.has(s.card_id)) continue;
        s.next_due_on = dueDateForCycleDay(
          realToday, cycleDay, s.bucket_index, deck.bucket_intervals_days,
        );
      }
    }
    a.cycle_start_date = cycle_start_date;
    return { deck_id: deckId, child_id: childId, cycle_start_date };
  },
```

(`addDays` and `dueDateForCycleDay` are already imported in mock.ts.)

- [ ] **Step 6: Supabase — `CHILD_COLS`, replace `applyCycleDay`, add `getDeckAssignment`**

In `src/lib/db/supabase.ts`:

(a) Add `DeckAssignment` to the domain import (the `import type { … } from '@/types/domain';` line):

```ts
import type { Card, CardState, Child, Deck, DeckAssignment, Parent, Review } from '@/types/domain';
```

(b) Drop `cycle_start_date` from `CHILD_COLS` (line ~12):

```ts
const CHILD_COLS = 'id, parent_id, display_name, avatar, graduate_after_passes';
```

(c) Replace the whole existing `applyCycleDay` method with these two methods:

```ts
  async getDeckAssignment(deckId, childId): Promise<DeckAssignment | null> {
    const { data, error } = await supabase
      .from('deck_assignments')
      .select('deck_id, child_id, cycle_start_date')
      .eq('deck_id', deckId)
      .eq('child_id', childId)
      .maybeSingle();
    if (error) throw error;
    return (data as DeckAssignment | null) ?? null;
  },
  async applyCycleDay(childId, deckId, cycleDay, realToday): Promise<DeckAssignment> {
    const cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay);

    // This child's non-graduated states, joined to each card's deck id + intervals.
    const { data: rows, error: sErr } = await supabase
      .from('card_states')
      .select('child_id, card_id, bucket_index, card:cards!inner(deck_id, deck:decks!inner(bucket_intervals_days))')
      .eq('child_id', childId)
      .is('graduated_at', null);
    if (sErr) throw sErr;

    type Row = {
      child_id: string;
      card_id: string;
      bucket_index: number;
      card: { deck_id: string; deck: { bucket_intervals_days: number[] } };
    };
    // Rewrite next_due_on FIRST, only for cards in THIS deck. Partial failure leaves
    // the pair on its old day with consistent dates; the op is idempotent on retry.
    for (const r of (rows as unknown as Row[]) ?? []) {
      if (r.card.deck_id !== deckId) continue;
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

    // Set the per-(child, deck) anchor LAST and return it.
    const { data: aRow, error: aErr } = await supabase
      .from('deck_assignments')
      .update({ cycle_start_date })
      .eq('deck_id', deckId)
      .eq('child_id', childId)
      .select('deck_id, child_id, cycle_start_date')
      .single();
    if (aErr) throw aErr;
    return aRow as DeckAssignment;
  },
```

(`addDays` and `dueDateForCycleDay` are already imported in supabase.ts.)

- [ ] **Step 7: `add-child.tsx` — drop the removed field**

In `src/app/add-child.tsx`, remove the `cycle_start_date: null,` line from the `db.createChild({ … })` payload (children no longer carry an anchor).

- [ ] **Step 8: Settings — remove the Schedule section**

In `src/app/(app)/settings.tsx`, delete everything that belonged to the per-child schedule control:

1. The three state hooks: `dayInput`, `dayError`, `dayFeedback` (the block commented "Day offset …", ~lines 49-53).
2. In the `useEffect` that syncs form fields, the `setDayInput(...)` line.
3. The `appliedDay` derivation line.
4. The `applyDayOffset` and `resetDayOffset` functions in full.
5. The `previewDay` / `previewBuckets` derivations.
6. The entire `{/* Schedule … */}` JSX block (the `<ThemedText type="smallBold">Schedule</ThemedText>` heading and its `<ThemedView … style={styles.section}>` with the Day input, Apply/Reset buttons, preview text, and feedback).
7. Update the `@/lib/leitner` import to drop now-unused names — after removal Settings uses only `applyReview`:

```ts
import { applyReview } from '@/lib/leitner';
```

   and remove the `cycleDayOf` import if present. Keep the `getEffectiveToday` import (still used by `handleReset`/`handleMarkAllDone`). Leave the unrelated `styles` entries; unused style keys are not lint errors here, but if `npm run lint` flags any now-unused identifier, remove it.

- [ ] **Step 9: `import.tsx` placement — per-deck anchor**

In `src/app/(app)/decks/import.tsx`, the bucket-placement block currently computes the cycle day from the child. Replace:

```ts
        const realToday = getEffectiveToday('UTC');
        const cycleDay = cycleDayOf(child.cycle_start_date, realToday);
```

with (the deck was just assigned to the child two lines above, so the assignment exists):

```ts
        const realToday = getEffectiveToday('UTC');
        const assignment = await db.getDeckAssignment(deck.id, child.id);
        const cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday);
```

- [ ] **Step 10: `decks/[id].tsx` placement — per-deck anchor (two blocks)**

In `src/app/(app)/decks/[id].tsx`, both placement blocks read the cycle day from `currentChild.cycle_start_date`. Replace each.

Block 1 — the add-card handler. Replace:

```ts
        const realToday = getEffectiveToday('UTC');
        const cycleDay = cycleDayOf(currentChild.cycle_start_date, realToday);
```

with:

```ts
        const realToday = getEffectiveToday('UTC');
        const assignment = await db.getDeckAssignment(deck.id, currentChild.id);
        const cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday);
```

Block 2 — the `setBucket` handler. Replace:

```ts
    const realToday = getEffectiveToday('UTC');
    const cycleDay = cycleDayOf(currentChild.cycle_start_date, realToday);
```

with:

```ts
    const realToday = getEffectiveToday('UTC');
    const assignment = await db.getDeckAssignment(deck.id, currentChild.id);
    const cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday);
```

- [ ] **Step 11: Drop the now-unused `bucketsTestedOnDay`**

`bucketsTestedOnDay` in `src/lib/leitner.ts` was only used by the removed Settings preview. Confirm no remaining references:

Run: `grep -rn "bucketsTestedOnDay" src`
Expected: no matches. If clean, delete the `bucketsTestedOnDay` function (and its doc comment) from `src/lib/leitner.ts`. If any reference remains, leave the function and note it.

- [ ] **Step 12: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0. (Common misses: a leftover `child.cycle_start_date` / `currentChild.cycle_start_date`, an old 3-arg `applyCycleDay` call, or an unused import.)

Run: `npm run lint`
Expected: clean. Remove any import the linter flags as unused.

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations/0006_deck_cycle_start.sql src/types/domain.ts src/lib/db/types.ts \
  src/lib/db/mock.ts src/lib/db/supabase.ts src/lib/leitner.ts src/app/add-child.tsx \
  "src/app/(app)/settings.tsx" "src/app/(app)/decks/import.tsx" "src/app/(app)/decks/[id].tsx"
git commit -m "Move cycle anchor to per-(child,deck); per-deck applyCycleDay + getDeckAssignment"
```

---

## Task 3: Deck-screen control + deck-aware preview

**Files:**
- Modify: `src/app/(app)/decks/[id].tsx`

**Interfaces:**
- Consumes: `cycleDayOf`, `dueGroupsForDeckOnDay`, `bucketLetter` from `@/lib/leitner`; `DB.getDeckAssignment`, `DB.applyCycleDay` (Task 2); the screen's existing `currentChild`, `deck`, `cardStates`, `refresh`.

Add a per-(current child, this deck) schedule control to the deck detail screen, scoped to `currentChild` and rendered only when a child is selected. `refresh` (lines ~60-78) already fetches `parent` and the child's card states — extend it to also load the assignment anchor and parent timezone.

- [ ] **Step 1: Imports**

Ensure `src/app/(app)/decks/[id].tsx` imports these from `@/lib/leitner` (it already imports `cycleDayOf`, `dueDateForCycleDay`, `initialDueDate` as needed — add the two new names, keep existing ones):

```ts
import { bucketLetter, cycleDayOf, dueDateForCycleDay, dueGroupsForDeckOnDay } from '@/lib/leitner';
```

(Adjust to preserve whatever else the file already imports from `@/lib/leitner`; the additions are `bucketLetter` and `dueGroupsForDeckOnDay`.)

- [ ] **Step 2: State**

Add near the other `useState` declarations (e.g. after `bucketPickerCardId`, ~line 29):

```ts
  // Per-(current child, this deck) Leitner schedule control.
  const [cycleStart, setCycleStart] = useState<string | null>(null);
  const [scheduleTz, setScheduleTz] = useState('UTC');
  const [dayInput, setDayInput] = useState('0');
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayFeedback, setDayFeedback] = useState<string | null>(null);
```

- [ ] **Step 3: Load the anchor + tz in `refresh`**

In the `refresh` callback, the `parent` value is already fetched. Capture its timezone, and when a child is selected load that pair's assignment. Replace the existing tail of `refresh`:

```ts
    setDeck(d);
    setCards(cs);
    setAssignedSet(new Set(assignedIds));
    if (parent) setChildren(await db.listChildren(parent.id));
    if (currentChild) {
      const all = await db.listCardStatesForChild(currentChild.id);
      setCardStates(new Map(all.map((s) => [s.card_id, s])));
    } else {
      setCardStates(new Map());
    }
```

with:

```ts
    setDeck(d);
    setCards(cs);
    setAssignedSet(new Set(assignedIds));
    setScheduleTz(parent?.timezone ?? 'UTC');
    if (parent) setChildren(await db.listChildren(parent.id));
    if (currentChild) {
      const all = await db.listCardStatesForChild(currentChild.id);
      setCardStates(new Map(all.map((s) => [s.card_id, s])));
      const assignment = await db.getDeckAssignment(id, currentChild.id);
      setCycleStart(assignment?.cycle_start_date ?? null);
      setDayInput(String(cycleDayOf(assignment?.cycle_start_date ?? null, getEffectiveToday(parent?.timezone ?? 'UTC'))));
    } else {
      setCardStates(new Map());
      setCycleStart(null);
    }
```

- [ ] **Step 4: Handlers + derived values**

Add these inside the component (e.g. after `setBucket`, before the `return`). `getEffectiveToday` is already imported in this file.

```ts
  const realToday = getEffectiveToday(scheduleTz);
  const appliedDay = cycleDayOf(cycleStart, realToday);
  const previewDay = (() => {
    const n = parseInt(dayInput.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const previewGroups =
    deck && currentChild
      ? dueGroupsForDeckOnDay([...cardStates.values()], deck.bucket_intervals_days, previewDay, realToday)
      : [];
  const previewDue = previewGroups.filter((g) => g.due > 0);
  const previewNotDue = previewGroups.filter((g) => g.notDue > 0);

  async function applyCycleDayForDeck(targetDay: number) {
    if (!deck || !currentChild) return;
    setDayError(null);
    setDayFeedback(null);
    if (!Number.isFinite(targetDay) || targetDay < 0) {
      setDayError('Day must be a non-negative integer.');
      return;
    }
    try {
      const updated = await db.applyCycleDay(currentChild.id, deck.id, targetDay, realToday);
      setCycleStart(updated.cycle_start_date);
      setDayInput(String(targetDay));
      setDayFeedback(targetDay === 0 ? 'Reset to a fresh start (day 0).' : `Repositioned to day ${targetDay}.`);
      setTimeout(() => setDayFeedback(null), 2000);
      await refresh();
    } catch (e) {
      setDayError(e instanceof Error ? e.message : 'Could not save.');
    }
  }
```

- [ ] **Step 5: Render the control**

Render this section inside the screen's scroll content, in the current-child-scoped area (a natural spot is right after the deck title/header and before the cards list), guarded so it only shows with a deck and a current child. Use the file's existing `ThemedText` / `ThemedView` / `Pressable` / `TextInput` components and follow its styling patterns (reuse an existing section style, e.g. the deck's container/section style, or inline minimal style):

```tsx
{deck && currentChild && (
  <ThemedView type="backgroundElement" style={{ padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two }}>
    <ThemedText type="smallBold">Schedule · {currentChild.display_name}</ThemedText>
    <ThemedText themeColor="textSecondary" type="small">
      What day of this deck&apos;s cycle is {currentChild.display_name} on? Applying rewrites
      this deck&apos;s due dates so the right groups come due — no backlog.
    </ThemedText>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
      <ThemedText>Day</ThemedText>
      <TextInput
        value={dayInput}
        onChangeText={setDayInput}
        placeholder="0"
        placeholderTextColor={theme.textSecondary}
        keyboardType="number-pad"
        style={{ fontSize: 16, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: theme.textSecondary, borderRadius: Spacing.two, minWidth: 48, textAlign: 'center', color: theme.text }}
      />
    </View>
    <ThemedText themeColor="textSecondary" type="small">
      {previewDue.length === 0
        ? `Day ${previewDay}: nothing in this deck would be due.`
        : `Day ${previewDay} — ${previewDue.reduce((n, g) => n + g.due, 0)} card${previewDue.reduce((n, g) => n + g.due, 0) === 1 ? '' : 's'} due: ${previewDue.map((g) => `${bucketLetter(g.bucket)} ×${g.due}`).join(', ')}${previewNotDue.length ? ` · not yet: ${previewNotDue.map((g) => `${bucketLetter(g.bucket)} ×${g.notDue}`).join(', ')}` : ''}`}
    </ThemedText>
    <View style={{ flexDirection: 'row', gap: Spacing.two }}>
      <Pressable
        onPress={() => applyCycleDayForDeck(0)}
        style={{ padding: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, borderColor: '#888', alignItems: 'center' }}>
        <ThemedText>Reset</ThemedText>
      </Pressable>
      <Pressable
        onPress={() => applyCycleDayForDeck(previewDay)}
        style={{ flex: 1, backgroundColor: '#3c87f7', paddingVertical: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' }}>
        <ThemedText style={{ color: '#fff', fontWeight: '600' }}>Apply</ThemedText>
      </Pressable>
    </View>
    <ThemedText themeColor="textSecondary" type="small">Currently on day {appliedDay}.</ThemedText>
    {dayError && <ThemedText style={{ color: '#d2433f' }}>{dayError}</ThemedText>}
    {dayFeedback && <ThemedText themeColor="textSecondary" type="small">{dayFeedback}</ThemedText>}
  </ThemedView>
)}
```

If `Spacing`, `View`, `TextInput`, `Pressable`, `theme`, `ThemedText`, `ThemedView` aren't already imported/available in this file, add the imports following the patterns already used by `settings.tsx` (same component set). Check the top of `decks/[id].tsx` first — most are already present.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run lint`
Expected: clean.

- [ ] **Step 7: Behavioral confirmation (no app launch needed)**

The preview math is already covered by Task 1's helper. Confirm by reading: `previewGroups` is fed `[...cardStates.values()]` (the current child's states for cards on this screen's deck), `deck.bucket_intervals_days`, `previewDay`, and `realToday`; `applyCycleDayForDeck(previewDay)` calls `db.applyCycleDay(child, deck, previewDay, realToday)` then `refresh()`. Report this trace. The interactive Expo smoke (set day 7, see only the right buckets due for the current child; a sibling deck unaffected) is best-effort — if you cannot launch the app here, say so.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/decks/[id].tsx"
git commit -m "Add per-deck schedule control and deck-aware due preview to deck screen"
```

---

## Self-Review

**Spec coverage:**
- Data model — `deck_assignments.cycle_start_date`, drop `children.cycle_start_date`, migration 0006, `DeckAssignment` type → Task 2 Steps 1, 2. ✓
- `applyCycleDay(child, deck, …)` scoped reschedule (this deck only, non-graduated, write-order-safe) + `getDeckAssignment` → Task 2 Steps 3, 5, 6. ✓
- `dueGroupsForDeckOnDay` preview helper → Task 1. ✓
- Control on the deck screen (current-child scoped, "currently on day N", Apply/Reset, actual-cards preview) → Task 3. ✓
- Settings Schedule section removed; `bucketsTestedOnDay` dropped → Task 2 Steps 8, 11. ✓
- Placement uses the per-deck anchor (import + both deck-editor blocks) → Task 2 Steps 9, 10. ✓
- `createCard`/`assignDeckToChild` unchanged (bucket-0 = real today) — not modified in any task. ✓
- Reads untouched — no task changes home/index/review. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. Task 3's render gives complete JSX; integration points are concrete (after the deck header, inside refresh). ✓

**Type consistency:** `getDeckAssignment(deckId, childId)` and `applyCycleDay(childId, deckId, cycleDay, realToday): Promise<DeckAssignment>` identical across interface (Step 3), mock (Step 5), supabase (Step 6), and call sites (Steps 9, 10; Task 3 Steps 3, 4). `DeckAssignment` shape `{deck_id, child_id, cycle_start_date}` consistent everywhere. `dueGroupsForDeckOnDay(states, intervals, cycleDay, realToday)` defined in Task 1, consumed in Task 3 Step 4 with matching arg order. `cycleDayOf(cycleStart, realToday)` used consistently. ✓

**tz note (minor, intentional):** the deck-screen control/preview use the parent timezone (threaded via `scheduleTz`), matching reads; the placement edits in Task 2 keep `getEffectiveToday('UTC')` as in the pre-existing code. The integer cycle day differs between UTC and parent tz only at a date boundary and self-corrects; not load-bearing.
