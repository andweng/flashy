// DB-agnostic interface. Implementations: mock (in-memory) for dev, supabase for prod.

import type { Card, CardState, Child, Deck, DeckAssignment, Parent, Review } from '@/types/domain';

export type CardStateWithCard = CardState & { card: Card; deck: Deck };

export interface DB {
  getCurrentParent(): Promise<Parent | null>;
  updateParent(patch: Partial<Omit<Parent, 'id'>>): Promise<Parent>;

  listChildren(parentId: string): Promise<Child[]>;
  getChild(id: string): Promise<Child | null>;
  createChild(input: Omit<Child, 'id'>): Promise<Child>;
  updateChild(id: string, patch: Partial<Omit<Child, 'id' | 'parent_id'>>): Promise<Child>;
  deleteChild(id: string): Promise<void>;

  listDecksForParent(parentId: string): Promise<Deck[]>;
  listDecksForChild(childId: string): Promise<Deck[]>;
  getDeck(id: string): Promise<Deck | null>;
  createDeck(input: Omit<Deck, 'id'>): Promise<Deck>;
  // When the patch shrinks bucket_intervals_days, card_states for this deck's
  // cards whose bucket_index falls out of range are re-clamped to the new top
  // bucket (index newLength-1): cards in removed buckets move down to the
  // bucket below the removed one. last_tested_on and the top-bucket pass
  // counter are left untouched, so due-ness and graduation progress carry over
  // onto the new bucket's grid.
  updateDeck(id: string, patch: Partial<Omit<Deck, 'id' | 'parent_id'>>): Promise<Deck>;
  deleteDeck(id: string): Promise<void>;

  listCardsInDeck(deckId: string): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  createCard(input: Omit<Card, 'id'>): Promise<Card>;
  updateCard(id: string, patch: Partial<Omit<Card, 'id' | 'deck_id'>>): Promise<Card>;
  deleteCard(id: string): Promise<void>;

  listDeckAssignments(deckId: string): Promise<string[]>; // returns child_ids
  assignDeckToChild(deckId: string, childId: string): Promise<void>;
  unassignDeckFromChild(deckId: string, childId: string): Promise<void>;

  listDueCardStatesForChild(childId: string, today: string): Promise<CardStateWithCard[]>;
  // Permanent (mastery) pool draws for today: up to the child's
  // permanent_draws_per_day cards, weighted by days-since-last-test (see
  // pickPermanentDraws in leitner.ts). Same assigned-deck gate as
  // listDueCardStatesForChild; the seeded draw is stable for the whole day.
  // `timezone` is the parent's, used to pin "answered today" in the review log —
  // a miss drops a card out of the pool, so the pool's own stamps can't see it.
  listPermanentDrawsForChild(
    childId: string,
    today: string,
    timezone: string,
  ): Promise<CardStateWithCard[]>;
  listCardStatesForChild(childId: string): Promise<CardState[]>;
  countDueCardsForChild(childId: string, today: string): Promise<number>;
  upsertCardState(state: CardState): Promise<void>;

  recordReview(input: Omit<Review, 'id' | 'reviewed_at'>): Promise<Review>;
  // Undo every review this child did today: revert each touched card to the
  // bucket/due-date it had before today and delete today's review rows.
  // Returns the number of cards reverted. `today` is the effective today;
  // `timezone` is the parent's IANA zone (for matching real review timestamps).
  resetTodaysReviewsForChild(childId: string, today: string, timezone: string): Promise<number>;

  getDeckAssignment(deckId: string, childId: string): Promise<DeckAssignment | null>;
  // Reposition (child, deck) onto cycle day `cycleDay` by persisting
  // deck_assignments.cycle_start_date (= realToday − cycleDay, or null for day 0).
  // Under the last_tested_on model this is anchor-only — due-ness is derived, so no
  // card rows are rewritten. Returns the updated assignment. `realToday` is today.
  applyCycleDay(childId: string, deckId: string, cycleDay: number, realToday: string): Promise<DeckAssignment>;
}
