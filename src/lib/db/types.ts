// DB-agnostic interface. Implementations: mock (in-memory) for dev, supabase for prod.

import type { Card, CardState, Child, Deck, Parent, Review } from '@/types/domain';

export type CardStateWithCard = CardState & { card: Card; deck: Deck };

export interface DB {
  getCurrentParent(): Promise<Parent | null>;

  listChildren(parentId: string): Promise<Child[]>;
  createChild(input: Omit<Child, 'id'>): Promise<Child>;

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
  upsertCardState(state: CardState): Promise<void>;

  recordReview(input: Omit<Review, 'id' | 'reviewed_at'>): Promise<Review>;
}
