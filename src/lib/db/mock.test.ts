// Integration tests for the mock DB's derived due-listing — exercises isDueToday
// through listDueCardStatesForChild / countDueCardsForChild, assignment gating,
// graduation, and start-date repositioning. Each test builds isolated entities
// (fresh ids) so the shared in-memory fixtures don't interfere.

import { addDays } from '@/lib/leitner';
import { mockDB } from './mock';
import type { CardState } from '@/types/domain';

const TODAY = '2026-07-08';

async function setupAssignedDeck(intervals: number[], backs: string[]) {
  const child = await mockDB.createChild({
    parent_id: 'p1',
    display_name: 'Tester',
    avatar: null,
    graduate_after_passes: null,
  });
  const deck = await mockDB.createDeck({
    parent_id: 'p1',
    name: 'Test deck',
    description: null,
    bucket_intervals_days: intervals,
  });
  const cards = [];
  for (const back of backs) {
    cards.push(
      await mockDB.createCard({
        deck_id: deck.id,
        front: 'front',
        back,
        grading_mode: 'self_grade',
        typed_alternates: [],
        choices: [],
      }),
    );
  }
  // Assigning fans out one bucket-0, last_tested_on=null state per card.
  await mockDB.assignDeckToChild(deck.id, child.id);
  return { child, deck, cards };
}

function stateFor(childId: string, cardId: string, patch: Partial<CardState>): CardState {
  return {
    child_id: childId,
    card_id: cardId,
    bucket_index: 0,
    last_tested_on: null,
    consecutive_passes_in_top_bucket: 0,
    graduated_at: null,
    last_reviewed_at: null,
    ...patch,
  };
}

describe('mockDB due-listing (last_tested_on model)', () => {
  it('fresh bucket-0 cards are all due', async () => {
    const { child } = await setupAssignedDeck([1, 2, 4], ['a', 'b', 'c']);
    const due = await mockDB.listDueCardStatesForChild(child.id, TODAY);
    expect(due.length).toBe(3);
    expect(await mockDB.countDueCardsForChild(child.id, TODAY)).toBe(3);
  });

  it('a card tested today drops out of the due list', async () => {
    const { child, cards } = await setupAssignedDeck([1, 2, 4], ['a', 'b', 'c']);
    await mockDB.upsertCardState(stateFor(child.id, cards[0].id, { last_tested_on: TODAY }));
    const due = await mockDB.listDueCardStatesForChild(child.id, TODAY);
    expect(due.length).toBe(2);
    expect(due.map((d) => d.card_id)).not.toContain(cards[0].id);
  });

  it('graduated cards are excluded', async () => {
    const { child, cards } = await setupAssignedDeck([1, 2, 4], ['a', 'b']);
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, { graduated_at: '2026-07-01T00:00:00Z' }),
    );
    expect((await mockDB.listDueCardStatesForChild(child.id, TODAY)).length).toBe(1);
  });

  it('unassigning a deck hides its cards even though their state persists', async () => {
    const { child, deck } = await setupAssignedDeck([1, 2, 4], ['a', 'b']);
    await mockDB.unassignDeckFromChild(deck.id, child.id);
    expect(await mockDB.listDueCardStatesForChild(child.id, TODAY)).toEqual([]);
    expect((await mockDB.listCardStatesForChild(child.id)).length).toBe(2);
  });

  it('repositioning the start date changes which cards are due (grid phase)', async () => {
    const { child, deck, cards } = await setupAssignedDeck([1, 2, 4], ['a']);
    // Bucket C (interval 4), last tested yesterday.
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, { bucket_index: 2, last_tested_on: addDays(TODAY, -1) }),
    );
    // Day 0 (fresh start): the most recent C slot is today, so a card last tested
    // yesterday is due.
    expect((await mockDB.listDueCardStatesForChild(child.id, TODAY)).length).toBe(1);
    // Reposition to cycle day 5: the most recent C slot is now yesterday, which the
    // card already satisfied → no longer due.
    await mockDB.applyCycleDay(child.id, deck.id, 5, TODAY);
    expect((await mockDB.listDueCardStatesForChild(child.id, TODAY)).length).toBe(0);
  });

  it('resetTodaysReviewsForChild reverts the bucket and forces the card due again', async () => {
    const { child, cards } = await setupAssignedDeck([1, 2, 4], ['a']);
    // Simulate a completed review: card sat in bucket 0 this morning, got promoted
    // to bucket 1 and stamped tested today (so it is not currently due).
    await mockDB.recordReview({
      child_id: child.id,
      card_id: cards[0].id,
      outcome: 'pass',
      bucket_before: 0,
      bucket_after: 1,
      user_input: null,
    });
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, { bucket_index: 1, last_tested_on: TODAY }),
    );
    expect((await mockDB.listDueCardStatesForChild(child.id, TODAY)).length).toBe(0);

    // Reset undoes it: back to the pre-review bucket, last_tested_on cleared to null.
    const n = await mockDB.resetTodaysReviewsForChild(child.id, TODAY, 'UTC');
    expect(n).toBe(1);
    const s = (await mockDB.listCardStatesForChild(child.id)).find((x) => x.card_id === cards[0].id)!;
    expect(s.bucket_index).toBe(0);
    expect(s.last_tested_on).toBeNull();
    // And it is due again today.
    expect((await mockDB.listDueCardStatesForChild(child.id, TODAY)).length).toBe(1);
  });
});

describe('mockDB.updateDeck bucket re-clamp (tier removal)', () => {
  it('shrinking the deck moves cards in removed buckets to the new top bucket', async () => {
    const { child, deck, cards } = await setupAssignedDeck([1, 2, 4, 8, 16], ['a', 'b', 'c', 'd']);
    // Two cards sit in E (index 4), one in D (index 3), one in A (index 0).
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, {
        bucket_index: 4,
        last_tested_on: addDays(TODAY, -3),
        consecutive_passes_in_top_bucket: 2,
      }),
    );
    await mockDB.upsertCardState(
      stateFor(child.id, cards[1].id, { bucket_index: 4, last_tested_on: TODAY }),
    );
    await mockDB.upsertCardState(
      stateFor(child.id, cards[2].id, { bucket_index: 3, last_tested_on: addDays(TODAY, -1) }),
    );
    await mockDB.upsertCardState(stateFor(child.id, cards[3].id, { bucket_index: 0 }));

    // Remove E (F would be the 6th; here A–E → A–D, E is the removed top).
    const updated = await mockDB.updateDeck(deck.id, { bucket_intervals_days: [1, 2, 4, 8] });
    expect(updated.bucket_intervals_days).toEqual([1, 2, 4, 8]);

    const states = (await mockDB.listCardStatesForChild(child.id))
      .filter((s) => cards.some((c) => c.id === s.card_id))
      .sort((a, b) => a.card_id.localeCompare(b.card_id));
    // E's cards re-clamped to the new top bucket D (index 3)...
    expect(states.find((s) => s.card_id === cards[0].id)!.bucket_index).toBe(3);
    expect(states.find((s) => s.card_id === cards[1].id)!.bucket_index).toBe(3);
    // ...while lower buckets are untouched.
    expect(states.find((s) => s.card_id === cards[2].id)!.bucket_index).toBe(3);
    expect(states.find((s) => s.card_id === cards[3].id)!.bucket_index).toBe(0);
    // last_tested_on and the top-bucket pass counter carry over unchanged.
    const moved = states.find((s) => s.card_id === cards[0].id)!;
    expect(moved.last_tested_on).toBe(addDays(TODAY, -3));
    expect(moved.consecutive_passes_in_top_bucket).toBe(2);
  });

  it('re-clamps states for every child, including unassigned ones', async () => {
    const { child, deck, cards } = await setupAssignedDeck([1, 2, 4, 8], ['a']);
    const other = await mockDB.createChild({
      parent_id: 'p1',
      display_name: 'Other',
      avatar: null,
      graduate_after_passes: null,
    });
    // A lingering state from a previous (now removed) assignment, bucket 3.
    await mockDB.upsertCardState(stateFor(other.id, cards[0].id, { bucket_index: 3 }));

    await mockDB.updateDeck(deck.id, { bucket_intervals_days: [1, 2, 4] });

    const assigned = (await mockDB.listCardStatesForChild(child.id)).find(
      (s) => s.card_id === cards[0].id,
    )!;
    const lingering = (await mockDB.listCardStatesForChild(other.id)).find(
      (s) => s.card_id === cards[0].id,
    )!;
    expect(assigned.bucket_index).toBe(0);
    expect(lingering.bucket_index).toBe(2);
  });

  it('does not touch other decks or in-range buckets', async () => {
    const { deck, cards } = await setupAssignedDeck([1, 2, 4, 8], ['a', 'b']);
    const otherDeck = await mockDB.createDeck({
      parent_id: 'p1',
      name: 'Other deck',
      description: null,
      bucket_intervals_days: [1, 2, 4, 8, 16],
    });
    const otherCard = await mockDB.createCard({
      deck_id: otherDeck.id,
      front: 'f',
      back: 'b',
      grading_mode: 'self_grade',
      typed_alternates: [],
      choices: [],
    });
    const child = await mockDB.createChild({
      parent_id: 'p1',
      display_name: 'NoAssign',
      avatar: null,
      graduate_after_passes: null,
    });
    // In-range buckets in the shrunk deck (both a top-adjacent one and a low one)
    // + a bucket-4 card in the other deck.
    await mockDB.upsertCardState(stateFor(child.id, cards[0].id, { bucket_index: 2 }));
    await mockDB.upsertCardState(stateFor(child.id, cards[1].id, { bucket_index: 0 }));
    await mockDB.upsertCardState(stateFor(child.id, otherCard.id, { bucket_index: 4 }));

    await mockDB.updateDeck(deck.id, { bucket_intervals_days: [1, 2, 4] });

    const ours = (await mockDB.listCardStatesForChild(child.id)).filter((s) =>
      cards.some((c) => c.id === s.card_id),
    );
    const theirs = (await mockDB.listCardStatesForChild(child.id)).find(
      (s) => s.card_id === otherCard.id,
    )!;
    expect(ours.map((s) => s.bucket_index).sort()).toEqual([0, 2]);
    expect(theirs.bucket_index).toBe(4);
  });

  it('is a no-op when the bucket count is unchanged or grows', async () => {
    const { child, deck, cards } = await setupAssignedDeck([1, 2, 4, 8], ['a', 'b']);
    await mockDB.upsertCardState(stateFor(child.id, cards[0].id, { bucket_index: 3 }));

    // Same length, different values: nothing to clamp.
    await mockDB.updateDeck(deck.id, { bucket_intervals_days: [1, 3, 7, 14] });
    // Growing: still nothing to clamp.
    await mockDB.updateDeck(deck.id, { bucket_intervals_days: [1, 2, 4, 8, 16] });

    const s = (await mockDB.listCardStatesForChild(child.id)).find(
      (x) => x.card_id === cards[0].id,
    )!;
    expect(s.bucket_index).toBe(3);
  });
});
