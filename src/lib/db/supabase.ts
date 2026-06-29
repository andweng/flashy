// Supabase-backed DB implementation. Mirror of mock.ts against the same interface.
// RLS handles auth scoping; we don't need to filter by parent_id ourselves except
// where the API takes it as input.

import { supabase } from '@/lib/supabase';
import { addDays, dueDateForCycleDay, todayInTz } from '@/lib/leitner';
import { getEffectiveToday } from '@/lib/today';
import type { Card, CardState, Child, Deck, DeckAssignment, Parent, Review } from '@/types/domain';
import type { CardStateWithCard, DB } from './types';

const PARENT_COLS = 'id, display_name, timezone';
const CHILD_COLS = 'id, parent_id, display_name, avatar, graduate_after_passes';
const DECK_COLS = 'id, parent_id, name, description, bucket_intervals_days';
const CARD_COLS = 'id, deck_id, front, back, grading_mode, typed_alternates, choices';
const CARD_STATE_COLS =
  'child_id, card_id, bucket_index, next_due_on, consecutive_passes_in_top_bucket, graduated_at, last_reviewed_at';
const REVIEW_COLS =
  'id, child_id, card_id, reviewed_at, outcome, bucket_before, bucket_after, user_input';

export const supabaseDB: DB = {
  async getCurrentParent(): Promise<Parent | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('parents')
      .select(PARENT_COLS)
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateParent(patch): Promise<Parent> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');
    const { data, error } = await supabase
      .from('parents')
      .update(patch)
      .eq('id', user.id)
      .select(PARENT_COLS)
      .single();
    if (error) throw error;
    return data as Parent;
  },

  async listChildren(parentId): Promise<Child[]> {
    const { data, error } = await supabase
      .from('children')
      .select(CHILD_COLS)
      .eq('parent_id', parentId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  },

  async getChild(id): Promise<Child | null> {
    const { data, error } = await supabase
      .from('children')
      .select(CHILD_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async createChild(input): Promise<Child> {
    const { data, error } = await supabase
      .from('children')
      .insert(input)
      .select(CHILD_COLS)
      .single();
    if (error) throw error;
    return data as Child;
  },
  async updateChild(id, patch): Promise<Child> {
    const { data, error } = await supabase
      .from('children')
      .update(patch)
      .eq('id', id)
      .select(CHILD_COLS)
      .single();
    if (error) throw error;
    return data as Child;
  },
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
  async deleteChild(id) {
    // FK cascade handles card_states + deck_assignments.
    const { error } = await supabase.from('children').delete().eq('id', id);
    if (error) throw error;
  },

  async listDecksForParent(parentId): Promise<Deck[]> {
    const { data, error } = await supabase
      .from('decks')
      .select(DECK_COLS)
      .eq('parent_id', parentId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  },

  async listDecksForChild(childId): Promise<Deck[]> {
    const { data, error } = await supabase
      .from('deck_assignments')
      .select(`deck:decks(${DECK_COLS})`)
      .eq('child_id', childId);
    if (error) throw error;
    // supabase-js types joined relations as arrays; the actual response is one object per row.
    const rows = (data ?? []) as unknown as { deck: Deck | null }[];
    return rows.map((row) => row.deck).filter((d): d is Deck => d !== null);
  },

  async getDeck(id): Promise<Deck | null> {
    const { data, error } = await supabase
      .from('decks')
      .select(DECK_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async createDeck(input): Promise<Deck> {
    const { data, error } = await supabase
      .from('decks')
      .insert(input)
      .select(DECK_COLS)
      .single();
    if (error) throw error;
    return data as Deck;
  },
  async updateDeck(id, patch): Promise<Deck> {
    const { data, error } = await supabase
      .from('decks')
      .update(patch)
      .eq('id', id)
      .select(DECK_COLS)
      .single();
    if (error) throw error;
    return data as Deck;
  },
  async deleteDeck(id) {
    // FK cascade handles cards, deck_assignments, card_states.
    const { error } = await supabase.from('decks').delete().eq('id', id);
    if (error) throw error;
  },

  async listCardsInDeck(deckId): Promise<Card[]> {
    const { data, error } = await supabase
      .from('cards')
      .select(CARD_COLS)
      .eq('deck_id', deckId)
      .order('created_at');
    if (error) throw error;
    return data ?? [];
  },
  async getCard(id): Promise<Card | null> {
    const { data, error } = await supabase
      .from('cards')
      .select(CARD_COLS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  async createCard(input): Promise<Card> {
    const { data: card, error: e1 } = await supabase
      .from('cards')
      .insert(input)
      .select(CARD_COLS)
      .single();
    if (e1) throw e1;
    // Fan out card_states for already-assigned children.
    const { data: assignments, error: e2 } = await supabase
      .from('deck_assignments')
      .select('child_id')
      .eq('deck_id', input.deck_id);
    if (e2) throw e2;
    const childIds = ((assignments ?? []) as { child_id: string }[]).map((a) => a.child_id);
    if (childIds.length) {
      const today = getEffectiveToday();
      const rows = childIds.map((childId) => ({
        child_id: childId,
        card_id: (card as { id: string }).id,
        bucket_index: 0,
        next_due_on: today,
        consecutive_passes_in_top_bucket: 0,
        graduated_at: null,
        last_reviewed_at: null,
      }));
      const { error: e3 } = await supabase
        .from('card_states')
        .upsert(rows, { onConflict: 'child_id,card_id' });
      if (e3) throw e3;
    }
    return card as Card;
  },
  async updateCard(id, patch): Promise<Card> {
    const { data, error } = await supabase
      .from('cards')
      .update(patch)
      .eq('id', id)
      .select(CARD_COLS)
      .single();
    if (error) throw error;
    return data as Card;
  },
  async deleteCard(id) {
    const { error } = await supabase.from('cards').delete().eq('id', id);
    if (error) throw error;
  },

  async listDeckAssignments(deckId): Promise<string[]> {
    const { data, error } = await supabase
      .from('deck_assignments')
      .select('child_id')
      .eq('deck_id', deckId);
    if (error) throw error;
    return ((data ?? []) as { child_id: string }[]).map((row) => row.child_id);
  },
  async assignDeckToChild(deckId, childId) {
    const { error } = await supabase
      .from('deck_assignments')
      .upsert({ deck_id: deckId, child_id: childId }, { onConflict: 'deck_id,child_id' });
    if (error) throw error;
    // Fan out card_states for existing cards in this deck.
    const { data: cardRows, error: e2 } = await supabase
      .from('cards')
      .select('id')
      .eq('deck_id', deckId);
    if (e2) throw e2;
    const cardIds = ((cardRows ?? []) as { id: string }[]).map((c) => c.id);
    if (cardIds.length) {
      const today = getEffectiveToday();
      const rows = cardIds.map((cardId) => ({
        child_id: childId,
        card_id: cardId,
        bucket_index: 0,
        next_due_on: today,
        consecutive_passes_in_top_bucket: 0,
        graduated_at: null,
        last_reviewed_at: null,
      }));
      const { error: e3 } = await supabase
        .from('card_states')
        .upsert(rows, { onConflict: 'child_id,card_id' });
      if (e3) throw e3;
    }
  },
  async unassignDeckFromChild(deckId, childId) {
    const { error } = await supabase
      .from('deck_assignments')
      .delete()
      .eq('deck_id', deckId)
      .eq('child_id', childId);
    if (error) throw error;
  },

  async listDueCardStatesForChild(childId, today): Promise<CardStateWithCard[]> {
    // Restrict to decks currently assigned to this child. card_states persist
    // after a deck is unassigned (to preserve progress) and can also be created
    // for unassigned decks via the deck editor, so gating only on child_id would
    // leak cross-deck cards into review.
    const { data: assignRows, error: assignErr } = await supabase
      .from('deck_assignments')
      .select('deck_id')
      .eq('child_id', childId);
    if (assignErr) throw assignErr;
    const assignedDeckIds = new Set((assignRows ?? []).map((r) => r.deck_id));
    if (assignedDeckIds.size === 0) return [];

    const { data, error } = await supabase
      .from('card_states')
      .select(`
        ${CARD_STATE_COLS},
        card:cards!inner(
          ${CARD_COLS},
          deck:decks!inner(${DECK_COLS})
        )
      `)
      .eq('child_id', childId)
      .is('graduated_at', null)
      .lte('next_due_on', today);
    if (error) throw error;

    type Row = CardState & { card: Card & { deck: Deck } };
    return ((data as unknown as Row[]) ?? [])
      .map((row) => {
        const { card, ...stateFields } = row;
        const { deck, ...cardFields } = card;
        return { ...stateFields, card: cardFields, deck };
      })
      .filter((row) => assignedDeckIds.has(row.deck.id));
  },

  async listCardStatesForChild(childId): Promise<CardState[]> {
    const { data, error } = await supabase
      .from('card_states')
      .select(CARD_STATE_COLS)
      .eq('child_id', childId);
    if (error) throw error;
    return data ?? [];
  },

  async upsertCardState(state) {
    const { error } = await supabase
      .from('card_states')
      .upsert(state, { onConflict: 'child_id,card_id' });
    if (error) throw error;
  },

  async recordReview(input): Promise<Review> {
    const { data, error } = await supabase
      .from('reviews')
      .insert(input)
      .select(REVIEW_COLS)
      .single();
    if (error) throw error;
    return data as Review;
  },

  async countDueCardsForChild(childId, today): Promise<number> {
    // Mirror listDueCardStatesForChild's assignment gating so the home badge
    // doesn't count cards from decks no longer in the child's rotation.
    const due = await supabaseDB.listDueCardStatesForChild(childId, today);
    return due.length;
  },

  async resetTodaysReviewsForChild(childId, today, timezone): Promise<number> {
    // Reviews carry real wall-clock timestamps, so match against the real
    // calendar day in the parent's timezone (not the possibly dev-offset
    // `today`). Pull a coarse 1-day window, then filter to the exact tz date.
    const realToday = todayInTz(timezone);
    const sinceIso = `${addDays(realToday, -1)}T00:00:00.000Z`;
    const { data: recent, error } = await supabase
      .from('reviews')
      .select('id, card_id, bucket_before, reviewed_at')
      .eq('child_id', childId)
      .gte('reviewed_at', sinceIso)
      .order('reviewed_at', { ascending: true });
    if (error) throw error;

    const todays = (recent ?? []).filter(
      (r) => todayInTz(timezone, new Date(r.reviewed_at as string)) === realToday,
    );
    if (todays.length === 0) return 0;

    // The earliest review of the day holds the bucket the card had this morning.
    const bucketBefore = new Map<string, number>();
    for (const r of todays) {
      if (!bucketBefore.has(r.card_id as string)) {
        bucketBefore.set(r.card_id as string, r.bucket_before as number);
      }
    }

    for (const [cardId, bucket] of bucketBefore) {
      const { error: upErr } = await supabase
        .from('card_states')
        .update({
          bucket_index: bucket,
          next_due_on: today,
          consecutive_passes_in_top_bucket: 0,
          graduated_at: null,
          last_reviewed_at: null,
        })
        .eq('child_id', childId)
        .eq('card_id', cardId);
      if (upErr) throw upErr;
    }

    const { error: delErr } = await supabase
      .from('reviews')
      .delete()
      .in('id', todays.map((r) => r.id));
    if (delErr) throw delErr;

    return bucketBefore.size;
  },
};
