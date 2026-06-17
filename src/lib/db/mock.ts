// In-memory mock DB used while building UI. Reads/writes a fixture set.
// Swap to a Supabase-backed impl in lib/db/index.ts when ready.

import { addDays } from '@/lib/leitner';
import { getEffectiveToday } from '@/lib/today';
import type { Card, CardState, Child, Deck, Parent, Review } from '@/types/domain';
import type { CardStateWithCard, DB } from './types';

// Computed at module load so mock "due today" stays relative to the calendar.
const TODAY = new Intl.DateTimeFormat('en-CA').format(new Date());

const parent: Parent = {
  id: 'p1',
  display_name: 'Andrew',
  timezone: 'America/Los_Angeles',
};

const children: Child[] = [
  { id: 'c1', parent_id: 'p1', display_name: 'Mira', avatar: '🦊', graduate_after_passes: null },
  { id: 'c2', parent_id: 'p1', display_name: 'Eli', avatar: '🐻', graduate_after_passes: 3 },
];

const decks: Deck[] = [
  { id: 'd1', parent_id: 'p1', name: 'Multiplication Facts', description: 'Times tables 1–12', bucket_intervals_days: [1, 2, 4, 8, 16] },
  { id: 'd2', parent_id: 'p1', name: 'Spanish Words', description: null, bucket_intervals_days: [1, 2, 4, 8, 16] },
  { id: 'd3', parent_id: 'p1', name: 'World Capitals', description: null, bucket_intervals_days: [1, 3, 7, 14, 30] },
];

const assignments: Array<{ deck_id: string; child_id: string }> = [
  { deck_id: 'd1', child_id: 'c1' },
  { deck_id: 'd2', child_id: 'c1' },
  { deck_id: 'd2', child_id: 'c2' },
  { deck_id: 'd3', child_id: 'c1' },
];

let cardSeq = 0;
const makeCard = (
  deck_id: string,
  front: string,
  back: string,
  grading_mode: 'self_grade' | 'typed' = 'self_grade',
  typed_alternates: string[] = [],
): Card => ({
  id: `card-${++cardSeq}`,
  deck_id,
  front,
  back,
  grading_mode,
  typed_alternates,
});

const cards: Card[] = [
  makeCard('d1', '6 × 7', '42'),
  makeCard('d1', '8 × 7', '56'),
  makeCard('d1', '9 × 6', '54'),
  makeCard('d1', '12 × 3', '36'),
  makeCard('d1', '7 × 7', '49'),
  makeCard('d1', '11 × 4', '44'),
  makeCard('d2', 'hola', 'hello', 'typed', ['hi']),
  makeCard('d2', 'gracias', 'thank you', 'typed', ['thanks']),
  makeCard('d2', 'agua', 'water', 'typed'),
  makeCard('d2', 'gato', 'cat', 'typed'),
  makeCard('d2', 'libro', 'book', 'typed'),
  makeCard('d3', 'France', 'Paris'),
  makeCard('d3', 'Japan', 'Tokyo'),
  makeCard('d3', 'Brazil', 'Brasília'),
  makeCard('d3', 'Egypt', 'Cairo'),
  makeCard('d3', 'Kenya', 'Nairobi'),
];

// Spread states across buckets and due dates to make the home screen look real.
const PATTERNS: Array<{ bucket: number; daysOffset: number }> = [
  { bucket: 0, daysOffset: 0 },
  { bucket: 0, daysOffset: -1 },
  { bucket: 1, daysOffset: 0 },
  { bucket: 2, daysOffset: -3 },
  { bucket: 1, daysOffset: 2 },
  { bucket: 3, daysOffset: 0 },
];

const states: CardState[] = (() => {
  const out: CardState[] = [];
  for (const a of assignments) {
    const deckCards = cards.filter((c) => c.deck_id === a.deck_id);
    deckCards.forEach((card, i) => {
      const p = PATTERNS[i % PATTERNS.length];
      out.push({
        child_id: a.child_id,
        card_id: card.id,
        bucket_index: p.bucket,
        next_due_on: addDays(TODAY, p.daysOffset),
        consecutive_passes_in_top_bucket: 0,
        graduated_at: null,
        last_reviewed_at: null,
      });
    });
  }
  return out;
})();

const reviews: Review[] = [];

export const mockDB: DB = {
  async getCurrentParent() {
    return parent;
  },
  async listChildren(parentId) {
    return children.filter((c) => c.parent_id === parentId);
  },
  async getChild(id) {
    return children.find((c) => c.id === id) ?? null;
  },
  async createChild(input) {
    const child: Child = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...input,
    };
    children.push(child);
    return child;
  },
  async updateChild(id, patch) {
    const idx = children.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('Child not found');
    children[idx] = { ...children[idx], ...patch };
    return children[idx];
  },
  async deleteChild(id) {
    // Cascade: drop card_states, deck_assignments, then the child itself.
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].child_id === id) states.splice(i, 1);
    }
    for (let i = assignments.length - 1; i >= 0; i--) {
      if (assignments[i].child_id === id) assignments.splice(i, 1);
    }
    const idx = children.findIndex((c) => c.id === id);
    if (idx >= 0) children.splice(idx, 1);
  },
  async listDecksForParent(parentId) {
    return decks.filter((d) => d.parent_id === parentId);
  },
  async listDecksForChild(childId) {
    const ids = new Set(assignments.filter((a) => a.child_id === childId).map((a) => a.deck_id));
    return decks.filter((d) => ids.has(d.id));
  },
  async getDeck(id) {
    return decks.find((d) => d.id === id) ?? null;
  },
  async createDeck(input) {
    const deck: Deck = {
      id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...input,
    };
    decks.push(deck);
    return deck;
  },
  async updateDeck(id, patch) {
    const idx = decks.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error('Deck not found');
    decks[idx] = { ...decks[idx], ...patch };
    return decks[idx];
  },
  async deleteDeck(id) {
    const cardIds = new Set(cards.filter((c) => c.deck_id === id).map((c) => c.id));
    for (let i = states.length - 1; i >= 0; i--) {
      if (cardIds.has(states[i].card_id)) states.splice(i, 1);
    }
    for (let i = cards.length - 1; i >= 0; i--) {
      if (cards[i].deck_id === id) cards.splice(i, 1);
    }
    for (let i = assignments.length - 1; i >= 0; i--) {
      if (assignments[i].deck_id === id) assignments.splice(i, 1);
    }
    const idx = decks.findIndex((d) => d.id === id);
    if (idx >= 0) decks.splice(idx, 1);
  },

  async listCardsInDeck(deckId) {
    return cards.filter((c) => c.deck_id === deckId);
  },
  async getCard(id) {
    return cards.find((c) => c.id === id) ?? null;
  },
  async createCard(input) {
    const card: Card = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...input,
    };
    cards.push(card);
    // Fan out card_states to children already assigned to this deck.
    const today = getEffectiveToday();
    for (const a of assignments.filter((a) => a.deck_id === input.deck_id)) {
      states.push({
        child_id: a.child_id,
        card_id: card.id,
        bucket_index: 0,
        next_due_on: today,
        consecutive_passes_in_top_bucket: 0,
        graduated_at: null,
        last_reviewed_at: null,
      });
    }
    return card;
  },
  async updateCard(id, patch) {
    const idx = cards.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('Card not found');
    cards[idx] = { ...cards[idx], ...patch };
    return cards[idx];
  },
  async deleteCard(id) {
    for (let i = states.length - 1; i >= 0; i--) {
      if (states[i].card_id === id) states.splice(i, 1);
    }
    const idx = cards.findIndex((c) => c.id === id);
    if (idx >= 0) cards.splice(idx, 1);
  },

  async listDeckAssignments(deckId) {
    return assignments.filter((a) => a.deck_id === deckId).map((a) => a.child_id);
  },
  async assignDeckToChild(deckId, childId) {
    if (assignments.some((a) => a.deck_id === deckId && a.child_id === childId)) return;
    assignments.push({ deck_id: deckId, child_id: childId });
    // Fan out card_states for existing cards in this deck.
    const today = getEffectiveToday();
    const deckCards = cards.filter((c) => c.deck_id === deckId);
    for (const card of deckCards) {
      const exists = states.some((s) => s.child_id === childId && s.card_id === card.id);
      if (!exists) {
        states.push({
          child_id: childId,
          card_id: card.id,
          bucket_index: 0,
          next_due_on: today,
          consecutive_passes_in_top_bucket: 0,
          graduated_at: null,
          last_reviewed_at: null,
        });
      }
    }
  },
  async unassignDeckFromChild(deckId, childId) {
    const idx = assignments.findIndex((a) => a.deck_id === deckId && a.child_id === childId);
    if (idx >= 0) assignments.splice(idx, 1);
    // card_states are kept — re-assignment preserves progress.
  },
  async listDueCardStatesForChild(childId, today): Promise<CardStateWithCard[]> {
    return states
      .filter((s) => s.child_id === childId && s.next_due_on <= today && !s.graduated_at)
      .map((s) => {
        const card = cards.find((c) => c.id === s.card_id)!;
        const deck = decks.find((d) => d.id === card.deck_id)!;
        return { ...s, card, deck };
      });
  },
  async listCardStatesForChild(childId) {
    return states.filter((s) => s.child_id === childId);
  },
  async upsertCardState(s) {
    const idx = states.findIndex((x) => x.child_id === s.child_id && x.card_id === s.card_id);
    if (idx >= 0) states[idx] = s;
    else states.push(s);
  },
  async recordReview(input) {
    const review: Review = {
      id: reviews.length + 1,
      reviewed_at: new Date().toISOString(),
      ...input,
    };
    reviews.push(review);
    return review;
  },
};
