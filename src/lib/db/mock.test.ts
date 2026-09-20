// Integration tests for the mock DB's derived due-listing — exercises isDueToday
// through listDueCardStatesForChild / countDueCardsForChild, assignment gating,
// graduation, and start-date repositioning. Each test builds isolated entities
// (fresh ids) so the shared in-memory fixtures don't interfere.

import { addDays, applyReview, todayInTz } from '@/lib/leitner';
import { mockDB } from './mock';
import type { CardState } from '@/types/domain';

const TODAY = '2026-07-08';

async function setupAssignedDeck(intervals: number[], backs: string[]) {
  const child = await mockDB.createChild({
    parent_id: 'p1',
    display_name: 'Tester',
    avatar: null,
    graduate_after_passes: null,
    permanent_draws_per_day: 0,
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

  it('cards in the permanent bucket are excluded', async () => {
    const { child, cards } = await setupAssignedDeck([1, 2, 4], ['a', 'b']);
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, { bucket_index: 3 }), // 3 intervals ⇒ permanent
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
      permanent_draws_per_day: 0,
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
      permanent_draws_per_day: 0,
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

describe('mockDB permanent-pool draws (daily weighted lottery)', () => {
  it('y = 0 → never drawn, even with permanent cards', async () => {
    const { child, cards } = await setupAssignedDeck([1, 2, 4], ['a', 'b']);
    for (const c of cards) {
      await mockDB.upsertCardState(
        stateFor(child.id, c.id, {
          bucket_index: 3, // 3 intervals ⇒ permanent
          last_tested_on: addDays(TODAY, -5),
        }),
      );
    }
    expect(await mockDB.listPermanentDrawsForChild(child.id, TODAY, 'UTC')).toEqual([]);
  });

  it('draws up to y permanent cards, excludes non-permanent ones, stable for the day', async () => {
    const child = await mockDB.createChild({
      parent_id: 'p1',
      display_name: 'Keeper kid',
      avatar: null,
      graduate_after_passes: 3,
      permanent_draws_per_day: 2,
    });
    const deck = await mockDB.createDeck({
      parent_id: 'p1',
      name: 'Keeper deck',
      description: null,
      bucket_intervals_days: [1, 2, 4],
    });
    const cards: string[] = [];
    for (let i = 0; i < 5; i++) {
      const card = await mockDB.createCard({
        deck_id: deck.id,
        front: 'front',
        back: `back${i}`,
        grading_mode: 'self_grade',
        typed_alternates: [],
        choices: [],
      });
      cards.push(card.id);
    }
    await mockDB.assignDeckToChild(deck.id, child.id);
    for (let i = 0; i < 5; i++) {
      await mockDB.upsertCardState(
        stateFor(child.id, cards[i], {
          // 3 permanent (index 3 = one past the deck's 3 intervals), 2 in the grid.
          bucket_index: i < 3 ? 3 : 2,
          last_tested_on: addDays(TODAY, -(i + 1)),
        }),
      );
    }
    const drawn = await mockDB.listPermanentDrawsForChild(child.id, TODAY, 'UTC');
    expect(drawn.length).toBe(2);
    expect(drawn.every((r) => r.bucket_index === 3)).toBe(true);
    // Grid cards are excluded from the lottery entirely.
    expect(drawn.every((r) => cards.indexOf(r.card_id) < 3)).toBe(true);
    // Day-stable: calling again (e.g. a refresh) yields the same picks.
    const again = await mockDB.listPermanentDrawsForChild(child.id, TODAY, 'UTC');
    expect(again.map((r) => r.card_id)).toEqual(drawn.map((r) => r.card_id));
  });

  it('unassigning a deck hides its keepers from the draw', async () => {
    const { child, deck, cards } = await setupAssignedDeck([1, 2, 4], ['a']);
    await mockDB.updateChild(child.id, { permanent_draws_per_day: 3 });
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, {
        bucket_index: 3, // 3 intervals ⇒ permanent
        last_tested_on: addDays(TODAY, -5),
      }),
    );
    expect((await mockDB.listPermanentDrawsForChild(child.id, TODAY, 'UTC')).length).toBe(1);
    await mockDB.unassignDeckFromChild(deck.id, child.id);
    expect(await mockDB.listPermanentDrawsForChild(child.id, TODAY, 'UTC')).toEqual([]);
  });

  it('reset preserves established permanence but undoes today\'s fresh graduations', async () => {
    // Deck has 3 intervals, so bucket 2 is the top interval and 3 is permanent.
    // Restoring bucket_before is all the reset has to do — permanence rides along.
    const { child, cards } = await setupAssignedDeck([1, 2, 4], ['a', 'b']);
    // Card 0: permanent since last week, re-tested via the lottery this morning.
    await mockDB.recordReview({
      child_id: child.id,
      card_id: cards[0].id,
      outcome: 'pass',
      bucket_before: 3,
      bucket_after: 3,
      user_input: null,
    });
    await mockDB.upsertCardState(
      stateFor(child.id, cards[0].id, { bucket_index: 3, last_tested_on: TODAY }),
    );
    // Card 1: graduated out of the top interval bucket for the first time today.
    await mockDB.recordReview({
      child_id: child.id,
      card_id: cards[1].id,
      outcome: 'pass',
      bucket_before: 2,
      bucket_after: 3,
      user_input: null,
    });
    await mockDB.upsertCardState(
      stateFor(child.id, cards[1].id, { bucket_index: 3, last_tested_on: TODAY }),
    );

    const n = await mockDB.resetTodaysReviewsForChild(child.id, TODAY, 'UTC');
    expect(n).toBe(2);
    const [s0, s1] = (await mockDB.listCardStatesForChild(child.id)).filter(
      (s) => s.card_id === cards[0].id || s.card_id === cards[1].id,
    );
    expect(s0.bucket_index).toBe(3); // still permanent
    expect(s1.bucket_index).toBe(2); // fresh graduation undone
  });

  // Evan's shape: a 13-card permanent pool, 6 draws/day, every answer wrong.
  // A miss drops the card to bucket 0, which used to take it out of the pool and
  // refund its draw slot — draining the whole pool in a single day.
  it('a missed permanent card still spends its slot', async () => {
    const today = todayInTz('UTC');
    const child = await mockDB.createChild({
      parent_id: 'p1', display_name: 'Leak', avatar: null,
      graduate_after_passes: 3, permanent_draws_per_day: 6,
    });
    const deck = await mockDB.createDeck({
      parent_id: 'p1', name: 'Leak deck', description: null, bucket_intervals_days: [1, 2, 4, 8, 16],
    });
    for (let i = 0; i < 13; i++) {
      await mockDB.createCard({
        deck_id: deck.id, front: `f${i}`, back: `b${i}`,
        grading_mode: 'self_grade', typed_alternates: [], choices: [],
      });
    }
    await mockDB.assignDeckToChild(deck.id, child.id);
    const states = await mockDB.listCardStatesForChild(child.id);
    for (const [i, s] of states.entries()) {
      await mockDB.upsertCardState({
        ...s, bucket_index: 5, // 5 intervals ⇒ permanent
        consecutive_passes_in_top_bucket: 3, last_tested_on: addDays(today, -(2 + i)),
      });
    }

    let answered = 0;
    for (let round = 0; round < 6; round++) {
      const drawn = await mockDB.listPermanentDrawsForChild(child.id, today, 'UTC');
      if (drawn.length === 0) break;
      for (const d of drawn) {
        const { card, deck: dk, ...state } = d;
        const update = applyReview(state, dk, child, today, { kind: 'fail' });
        await mockDB.upsertCardState(update.next_state);
        await mockDB.recordReview({
          child_id: child.id, card_id: card.id, outcome: 'fail',
          bucket_before: state.bucket_index, bucket_after: update.next_state.bucket_index,
          user_input: null,
        });
        answered++;
      }
    }
    expect(answered).toBe(6); // was 13 before the fix
  });
});
