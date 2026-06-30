# Due-Today Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tappable "Due today" chip to each card row in the deck manager that flips the card between due-today and its natural schedule.

**Architecture:** Reuse the existing `CardState.next_due_on` field — no schema change. A pure helper `isDueOn` decides chip appearance; a `toggleDue` handler (mirroring the existing `setBucket`) flips `next_due_on` between `realToday` (force due) and `dueDateForCycleDay(...)` (return to schedule) and persists via `db.upsertCardState`.

**Tech Stack:** React Native + Expo Router, TypeScript, Supabase (via `db` abstraction). Spec: [docs/superpowers/specs/2026-06-30-due-today-toggle-design.md](../specs/2026-06-30-due-today-toggle-design.md).

## Global Constraints

- No test framework exists. Verification = `npx tsc --noEmit` and `npm run lint`. There are no unit-test steps; the "failing check" in each task is a typecheck against a not-yet-existing symbol.
- No DB schema change. Only `next_due_on` is written; `bucket_index`, `consecutive_passes_in_top_bucket`, `graduated_at`, `last_reviewed_at` are preserved unchanged.
- Dates are ISO `YYYY-MM-DD` strings; string comparison is valid for ordering.
- Follow existing patterns in [src/app/(app)/decks/[id].tsx](../../../src/app/(app)/decks/[id].tsx) — especially `setBucket` (lines ~210-232) for the handler and the Bucket chip (lines ~700-710) for the UI.
- Expo is pinned to SDK v56; consult https://docs.expo.dev/versions/v56.0.0/ before adding any new API. This feature uses only already-imported primitives (`Pressable`, `View`, `ThemedText`), so no new APIs are expected.

---

### Task 1: `isDueOn` pure helper

**Files:**
- Modify: `src/lib/leitner.ts` (add export near `owedReviews`, ~line 107)

**Interfaces:**
- Consumes: `CardState` type (already imported in `leitner.ts`).
- Produces: `isDueOn(state: CardState, today: string): boolean` — true iff the card owes a review on `today` and is not graduated. Consumed by Task 2.

- [ ] **Step 1: Add the helper**

In `src/lib/leitner.ts`, immediately above `owedReviews` (the line `// How many reviews a card owes by \`today\`.`), insert:

```ts
// True iff the card is due on `today` (due today or overdue) and not graduated.
// Mirrors the review-queue filter (graduated_at is null AND next_due_on <= today).
export function isDueOn(state: CardState, today: string): boolean {
  return !state.graduated_at && state.next_due_on <= today;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The new function is exported but not yet used — that is fine.

- [ ] **Step 3: Commit**

```bash
git add src/lib/leitner.ts
git commit -m "Add isDueOn helper for card due-today state"
```

---

### Task 2: `toggleDue` handler + "Due today" chip

**Files:**
- Modify: `src/app/(app)/decks/[id].tsx`
  - Add `isDueOn` to the `@/lib/leitner` import (line 14)
  - Add `toggleDue` handler after `setBucket` (~line 232)
  - Add the chip in `rowActions` before the Bucket chip (~line 700)
  - Add two styles to the `StyleSheet` (~line 879)

**Interfaces:**
- Consumes: `isDueOn` from Task 1; existing `db.getDeckAssignment`, `db.upsertCardState`, `cycleDayOf`, `dueDateForCycleDay`, `getEffectiveToday`, `cardStates` state map, `currentChild`, `deck`, `realToday` (already computed at render, line ~295).
- Produces: nothing consumed by later tasks (final task).

- [ ] **Step 1: Extend the leitner import**

Change line 14 from:

```ts
import { bucketLetter, cycleDayOf, dueDateForCycleDay, dueGroupsForDeckOnDay } from '@/lib/leitner';
```

to:

```ts
import { bucketLetter, cycleDayOf, dueDateForCycleDay, dueGroupsForDeckOnDay, isDueOn } from '@/lib/leitner';
```

- [ ] **Step 2: Add the `toggleDue` handler**

Immediately after the `setBucket` function's closing brace (the one ending at `setBucketPickerCardId(null);\n  }`, ~line 232), insert:

```ts
  async function toggleDue(cardId: string) {
    if (!currentChild || !deck) return;
    const existing = cardStates.get(cardId);
    if (!existing || existing.graduated_at) return;
    const realToday = getEffectiveToday('UTC');
    const assignment = await db.getDeckAssignment(deck.id, currentChild.id);
    const cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday);
    const next_due_on = isDueOn(existing, realToday)
      ? dueDateForCycleDay(realToday, cycleDay, existing.bucket_index, deck.bucket_intervals_days)
      : realToday;
    const newState: CardState = { ...existing, next_due_on };
    await db.upsertCardState(newState);
    setCardStates((m) => {
      const next = new Map(m);
      next.set(cardId, newState);
      return next;
    });
  }
```

Note: `toggleDue` uses `getEffectiveToday('UTC')` for the write (matching `setBucket`, which also uses `'UTC'`), while the chip's *display* uses the render-body `realToday` (`getEffectiveToday(scheduleTz)`). This mirrors the existing inconsistency between `setBucket` and the render body; do not "fix" it here.

- [ ] **Step 3: Add the chip in `rowActions`**

In the `rowActions` `View` (~line 699), the current first child is the Bucket-chip block `{currentChild && cardStates.has(card.id) && ( ... )}`. Insert this block *immediately before* it:

```tsx
                    {currentChild &&
                      cardStates.has(card.id) &&
                      !cardStates.get(card.id)!.graduated_at && (
                        <Pressable
                          onPress={() => toggleDue(card.id)}
                          style={[
                            styles.dueChip,
                            isDueOn(cardStates.get(card.id)!, realToday) && styles.dueChipActive,
                          ]}>
                          <ThemedText type="small">Due today</ThemedText>
                        </Pressable>
                      )}
```

- [ ] **Step 4: Add styles**

In the `StyleSheet.create({ ... })` block, after the `bucketChip` style (~line 878), add:

```ts
  dueChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  dueChipActive: { backgroundColor: '#3c87f720', borderColor: '#3c87f7' },
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: PASS (no new errors/warnings on the touched files).

- [ ] **Step 7: Manual verification**

Run the app (`npm run web` or device). With a child selected, open a deck:
- A not-due card shows an outline "Due today" chip. Tap it → chip fills blue; the card now appears in today's review (Home count rises).
- Tap the filled chip → it returns to outline (unless its bucket is naturally tested today, in which case it stays filled — expected).
- Graduated cards show no chip.

- [ ] **Step 8: Commit**

```bash
git add src/app/(app)/decks/[id].tsx
git commit -m "Add Due today toggle chip to deck-manager cards"
```

---

## Self-Review

**Spec coverage:**
- "Due today" chip on each card row → Task 2 Step 3. ✓
- Reads/writes `next_due_on`, no schema change → Task 2 Step 2. ✓
- Force due → `realToday`; un-due → `dueDateForCycleDay` (natural schedule) → Task 2 Step 2. ✓
- `isDueOn` pure helper → Task 1. ✓
- Gating `currentChild && cardStates.has && !graduated_at` → Task 2 Step 3. ✓
- Placement left of Bucket chip; filled/outline style → Task 2 Steps 3-4. ✓
- Handler mirrors `setBucket`, preserves other fields → Task 2 Step 2. ✓
- Edge cases (graduated no-op, toggle-off-still-due) → covered by gating + natural-schedule recompute. ✓

**Placeholder scan:** none.

**Type consistency:** `isDueOn(state: CardState, today: string): boolean` defined in Task 1, used identically in Task 2. `toggleDue(cardId: string)` matches the `card.id` string passed at the call site. `newState: CardState` built by spread preserves all required fields.
