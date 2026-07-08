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
