// In-memory mock DB used while building UI. Reads/writes a fixture set.
// Swap to a Supabase-backed impl in lib/db/index.ts when ready.

import { addDays, cycleDayOf, isDueToday, pickPermanentDraws, todayInTz } from '@/lib/leitner';
import type { Card, CardState, Child, Deck, DeckAssignment, GradingMode, Parent, Review } from '@/types/domain';
import type { CardStateWithCard, DB } from './types';

// Computed at module load so mock "due today" stays relative to the calendar.
const TODAY = new Intl.DateTimeFormat('en-CA').format(new Date());

const parent: Parent = {
  id: 'p1',
  display_name: 'Andrew',
  timezone: 'America/Los_Angeles',
};

const children: Child[] = [
  { id: 'c1', parent_id: 'p1', display_name: 'Mira', avatar: '🦊', graduate_after_passes: null, permanent_draws_per_day: 0 },
  { id: 'c2', parent_id: 'p1', display_name: 'Eli', avatar: '🐻', graduate_after_passes: 3, permanent_draws_per_day: 2 },
];

const decks: Deck[] = [
  { id: 'd1', parent_id: 'p1', name: 'Multiplication Facts', description: 'Times tables 1–12', bucket_intervals_days: [1, 2, 4, 8, 16] },
  { id: 'd2', parent_id: 'p1', name: 'Spanish Words', description: null, bucket_intervals_days: [1, 2, 4, 8, 16] },
  { id: 'd3', parent_id: 'p1', name: 'World Capitals', description: null, bucket_intervals_days: [1, 3, 7, 14, 30] },
];

const assignments: { deck_id: string; child_id: string; cycle_start_date?: string | null }[] = [
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
  grading_mode: GradingMode = 'self_grade',
  typed_alternates: string[] = [],
  choices: string[] = [],
): Card => ({
  id: `card-${++cardSeq}`,
  deck_id,
  front,
  back,
  grading_mode,
  typed_alternates,
  choices,
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

// Spread states across buckets and last-tested dates to make the home screen look
// real. At cycle day 0 (fresh start) a card is due iff last_tested is null or before
// today, so this mixes due (null / past) and not-due (today) cards.
const PATTERNS: { bucket: number; lastTested: string | null }[] = [
  { bucket: 0, lastTested: null }, // fresh → due
  { bucket: 0, lastTested: TODAY }, // done today → not due
  { bucket: 1, lastTested: addDays(TODAY, -2) }, // due
  { bucket: 2, lastTested: addDays(TODAY, -5) }, // due
  { bucket: 1, lastTested: TODAY }, // not due
  { bucket: 3, lastTested: null }, // fresh higher bucket → due
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
        last_tested_on: p.lastTested,
        consecutive_passes_in_top_bucket: 0,
        permanent_at: null,
        last_reviewed_at: null,
      });
    });
  }
  return out;
})();

const reviews: Review[] = [];

// Cards in buckets that no longer exist (the deck shrank) move down to the new
// top bucket. Only bucket_index is rewritten; last_tested_on and the top-bucket
// pass counter carry over so due-ness and graduation progress keep flowing on
// the new bucket's grid. States for unassigned children are re-clamped too —
// they persist to preserve progress.
function reclampBucketsForDeck(deckId: string, nextDeck: Deck) {
  const topIdx = nextDeck.bucket_intervals_days.length - 1;
  const deckCardIds = new Set(cards.filter((c) => c.deck_id === deckId).map((c) => c.id));
  for (const s of states) {
    if (deckCardIds.has(s.card_id) && s.bucket_index > topIdx) {
      s.bucket_index = topIdx;
    }
  }
}

export const mockDB: DB = {
  async getCurrentParent() {
    return parent;
  },
  async updateParent(patch) {
    Object.assign(parent, patch);
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
  async getDeckAssignment(deckId, childId): Promise<DeckAssignment | null> {
    const a = assignments.find((x) => x.deck_id === deckId && x.child_id === childId);
    return a
      ? { deck_id: a.deck_id, child_id: a.child_id, cycle_start_date: a.cycle_start_date ?? null }
      : null;
  },
  async applyCycleDay(childId, deckId, cycleDay, realToday): Promise<DeckAssignment> {
    const a = assignments.find((x) => x.deck_id === deckId && x.child_id === childId);
    if (!a) throw new Error('Deck not assigned to child');
    // Repositioning is now just moving the anchor: due-ness is derived from
    // last_tested_on + this start date, so no card rows need rewriting.
    const cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay);
    a.cycle_start_date = cycle_start_date;
    return { deck_id: deckId, child_id: childId, cycle_start_date };
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
    const next = { ...decks[idx], ...patch };
    decks[idx] = next;
    reclampBucketsForDeck(id, next);
    return next;
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
    // Fan out card_states to children already assigned to this deck. New bucket-0
    // cards start with last_tested_on = null, so they enter today's rotation.
    for (const a of assignments.filter((a) => a.deck_id === input.deck_id)) {
      states.push({
        child_id: a.child_id,
        card_id: card.id,
        bucket_index: 0,
        last_tested_on: null,
        consecutive_passes_in_top_bucket: 0,
        permanent_at: null,
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
    // Fan out card_states for existing cards in this deck (bucket 0, due now).
    const deckCards = cards.filter((c) => c.deck_id === deckId);
    for (const card of deckCards) {
      const exists = states.some((s) => s.child_id === childId && s.card_id === card.id);
      if (!exists) {
        states.push({
          child_id: childId,
          card_id: card.id,
          bucket_index: 0,
          last_tested_on: null,
          consecutive_passes_in_top_bucket: 0,
          permanent_at: null,
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
    // Only play decks currently in this child's rotation. card_states linger
    // after a deck is unassigned (to preserve progress) and can also be created
    // for unassigned decks via the deck editor, so gating purely on child_id
    // would leak cross-deck cards into review. Due-ness is derived per deck from
    // last_tested_on + the deck's cycle start (isDueToday).
    const startByDeck = new Map<string, string | null>(
      assignments
        .filter((a) => a.child_id === childId)
        .map((a) => [a.deck_id, a.cycle_start_date ?? null]),
    );
    return states
      .filter((s) => s.child_id === childId && !s.permanent_at)
      .map((s) => {
        const card = cards.find((c) => c.id === s.card_id)!;
        const deck = decks.find((d) => d.id === card.deck_id)!;
        return { ...s, card, deck };
      })
      .filter((row) => {
        if (!startByDeck.has(row.deck.id)) return false;
        const cycleDay = cycleDayOf(startByDeck.get(row.deck.id) ?? null, today);
        return isDueToday(row, row.deck.bucket_intervals_days, cycleDay, today);
      });
  },
  async listPermanentDrawsForChild(childId, today): Promise<CardStateWithCard[]> {
    // The daily weighted lottery over this child's permanent (mastery) cards.
    // Same assigned-deck gate as the due list; the draw itself is the pure,
    // day-stable pickPermanentDraws (seeded by child+today).
    const child = children.find((c) => c.id === childId);
    if (!child || child.permanent_draws_per_day <= 0) return [];
    const startByDeck = new Set(
      assignments.filter((a) => a.child_id === childId).map((a) => a.deck_id),
    );
    const pool = states
      .filter((s) => s.child_id === childId && s.permanent_at)
      .map((s) => {
        const card = cards.find((c) => c.id === s.card_id)!;
        const deck = decks.find((d) => d.id === card.deck_id)!;
        return { ...s, card, deck };
      })
      .filter((row) => startByDeck.has(row.deck.id));
    return pickPermanentDraws(pool, child.permanent_draws_per_day, today, `keeper:${childId}:${today}`);
  },
  async listCardStatesForChild(childId) {
    return states.filter((s) => s.child_id === childId);
  },
  async countDueCardsForChild(childId, today) {
    return (await mockDB.listDueCardStatesForChild(childId, today)).length;
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
  async resetTodaysReviewsForChild(childId, today, timezone) {
    const realToday = todayInTz(timezone);
    const todays = reviews
      .filter(
        (r) =>
          r.child_id === childId &&
          todayInTz(timezone, new Date(r.reviewed_at)) === realToday,
      )
      .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));
    if (todays.length === 0) return 0;

    const bucketBefore = new Map<string, number>();
    const permanentBefore = new Map<string, boolean>();
    for (const r of todays) {
      if (!bucketBefore.has(r.card_id)) {
        bucketBefore.set(r.card_id, r.bucket_before);
        permanentBefore.set(r.card_id, r.was_permanent_before);
      }
    }

    for (const [cardId, bucket] of bucketBefore) {
      const idx = states.findIndex((s) => s.child_id === childId && s.card_id === cardId);
      if (idx >= 0) {
        states[idx] = {
          ...states[idx],
          bucket_index: bucket,
          last_tested_on: null, // force due again for the rest of today
          consecutive_passes_in_top_bucket: 0,
          // Preserve permanent status only for cards already permanent before
          // today; today's fresh graduations are undone by the reset.
          permanent_at: permanentBefore.get(cardId) ? states[idx].permanent_at : null,
          last_reviewed_at: null,
        };
      }
    }

    const ids = new Set(todays.map((r) => r.id));
    for (let i = reviews.length - 1; i >= 0; i--) {
      if (ids.has(reviews[i].id)) reviews.splice(i, 1);
    }

    return bucketBefore.size;
  },
};
