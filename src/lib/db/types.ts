// DB-agnostic interface. Implementations: mock (in-memory) for dev, supabase for prod.

import type { Card, CardState, Child, Deck, Parent, Review } from '@/types/domain';

export type CardStateWithCard = CardState & { card: Card; deck: Deck };

export interface DB {
  getCurrentParent(): Promise<Parent | null>;

  listChildren(parentId: string): Promise<Child[]>;
  getChild(id: string): Promise<Child | null>;
  createChild(input: Omit<Child, 'id'>): Promise<Child>;
  updateChild(id: string, patch: Partial<Omit<Child, 'id' | 'parent_id'>>): Promise<Child>;
  deleteChild(id: string): Promise<void>;

  listDecksForParent(parentId: string): Promise<Deck[]>;
  listDecksForChild(childId: string): Promise<Deck[]>;
  getDeck(id: string): Promise<Deck | null>;
  createDeck(input: Omit<Deck, 'id'>): Promise<Deck>;
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
  listCardStatesForChild(childId: string): Promise<CardState[]>;
  countDueCardsForChild(childId: string, today: string): Promise<number>;
  upsertCardState(state: CardState): Promise<void>;

  recordReview(input: Omit<Review, 'id' | 'reviewed_at'>): Promise<Review>;
  // Undo every review this child did today: revert each touched card to the
  // bucket/due-date it had before today and delete today's review rows.
  // Returns the number of cards reverted. `today` is the effective today;
  // `timezone` is the parent's IANA zone (for matching real review timestamps).
  resetTodaysReviewsForChild(childId: string, today: string, timezone: string): Promise<number>;

  // Reposition a child onto cycle day `cycleDay`: persist cycle_start_date
  // (= realToday − cycleDay, or null for day 0) and rewrite every non-graduated
  // card_state's next_due_on via dueDateForCycleDay (no backlog). Returns the
  // updated child. `realToday` is the real calendar day in the parent's timezone.
  applyCycleDay(childId: string, cycleDay: number, realToday: string): Promise<Child>;
}
