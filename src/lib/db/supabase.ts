// Supabase-backed DB implementation. Mirror of mock.ts against the same interface.
// RLS handles auth scoping; we don't need to filter by parent_id ourselves except
// where the API takes it as input.

import { supabase } from '@/lib/supabase';
import {
  addDays,
  cycleDayOf,
  isDueToday,
  isPermanentBucket,
  permanentBucketIndex,
  pickPermanentDraws,
  todayInTz,
} from '@/lib/leitner';
import type { Card, CardState, Child, Deck, DeckAssignment, Parent, Review } from '@/types/domain';
import type { CardStateWithCard, DB } from './types';

const PARENT_COLS = 'id, display_name, timezone';
const CHILD_COLS =
  'id, parent_id, display_name, avatar, graduate_after_passes, permanent_draws_per_day';
const DECK_COLS = 'id, parent_id, name, description, bucket_intervals_days';
const CARD_COLS = 'id, deck_id, front, back, grading_mode, typed_alternates, choices';
const CARD_STATE_COLS =
  'child_id, card_id, bucket_index, last_tested_on, consecutive_passes_in_top_bucket, last_reviewed_at';
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
    // Repositioning is now just moving the anchor: due-ness is derived from
    // last_tested_on + this start date, so no card_states need rewriting.
    const cycle_start_date = cycleDay <= 0 ? null : addDays(realToday, -cycleDay);
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
    // Read the deck first: re-clamping needs the bucket count as it WAS, to tell
    // permanent cards (old last index) from cards in a removed interval tier.
    const prev = patch.bucket_intervals_days ? await supabaseDB.getDeck(id) : null;
    const { data, error } = await supabase
      .from('decks')
      .update(patch)
      .eq('id', id)
      .select(DECK_COLS)
      .single();
    if (error) throw error;
    const next = data as Deck;
    if (patch.bucket_intervals_days && prev) {
      const wasPermanent = permanentBucketIndex(prev.bucket_intervals_days);
      const nowPermanent = permanentBucketIndex(patch.bucket_intervals_days);
      const newTopInterval = nowPermanent - 1;
      // The deck shrank: cards in removed interval tiers move down to the new top
      // interval bucket, while cards that had graduated ride the change and stay
      // permanent — losing a tier is not a demotion of everything that mastered.
      // Only bucket_index is rewritten; last_tested_on and the top-bucket pass
      // counter carry over. Includes states of unassigned children (they persist
      // to preserve progress).
      const { data: cardRows, error: cErr } = await supabase
        .from('cards')
        .select('id')
        .eq('deck_id', id);
      if (cErr) throw cErr;
      const cardIds = ((cardRows ?? []) as { id: string }[]).map((c) => c.id);
      if (cardIds.length && nowPermanent !== wasPermanent) {
        const { error: pErr } = await supabase
          .from('card_states')
          .update({ bucket_index: nowPermanent })
          .in('card_id', cardIds)
          .gte('bucket_index', wasPermanent);
        if (pErr) throw pErr;
      }
      if (cardIds.length) {
        const { error: sErr } = await supabase
          .from('card_states')
          .update({ bucket_index: newTopInterval })
          .in('card_id', cardIds)
          .gt('bucket_index', newTopInterval)
          .lt('bucket_index', nowPermanent);
        if (sErr) throw sErr;
      }
    }
    return next;
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
      const rows = childIds.map((childId) => ({
        child_id: childId,
        card_id: (card as { id: string }).id,
        bucket_index: 0,
        last_tested_on: null,
        consecutive_passes_in_top_bucket: 0,
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
      const rows = cardIds.map((cardId) => ({
        child_id: childId,
        card_id: cardId,
        bucket_index: 0,
        last_tested_on: null,
        consecutive_passes_in_top_bucket: 0,
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
    // leak cross-deck cards into review. Due-ness is derived per deck from
    // last_tested_on + the deck's cycle start (isDueToday), so we pull the child's
    // live cards and filter in app rather than with an indexed date comparison.
    const { data: assignRows, error: assignErr } = await supabase
      .from('deck_assignments')
      .select('deck_id, cycle_start_date')
      .eq('child_id', childId);
    if (assignErr) throw assignErr;
    const startByDeck = new Map<string, string | null>(
      (assignRows ?? []).map((r) => [r.deck_id, (r.cycle_start_date as string | null) ?? null]),
    );
    if (startByDeck.size === 0) return [];

    const { data, error } = await supabase
      .from('card_states')
      .select(`
        ${CARD_STATE_COLS},
        card:cards!inner(
          ${CARD_COLS},
          deck:decks!inner(${DECK_COLS})
        )
      `)
      .eq('child_id', childId);
    if (error) throw error;

    type Row = CardState & { card: Card & { deck: Deck } };
    return ((data as unknown as Row[]) ?? [])
      .map((row) => {
        const { card, ...stateFields } = row;
        const { deck, ...cardFields } = card;
        return { ...stateFields, card: cardFields, deck };
      })
      .filter((row) => {
        if (!startByDeck.has(row.deck.id)) return false;
        const cycleDay = cycleDayOf(startByDeck.get(row.deck.id) ?? null, today);
        return isDueToday(row, row.deck.bucket_intervals_days, cycleDay, today);
      });
  },

  async listPermanentDrawsForChild(childId, today, timezone): Promise<CardStateWithCard[]> {
    // The daily weighted lottery over this child's permanent (mastery) cards
    // (see pickPermanentDraws in leitner.ts). Same assigned-deck gate as the
    // due list, so keepers from unassigned decks never leak into review.
    const child = await supabaseDB.getChild(childId);
    if (!child || child.permanent_draws_per_day <= 0) return [];
    const { data: assignRows, error: assignErr } = await supabase
      .from('deck_assignments')
      .select('deck_id')
      .eq('child_id', childId);
    if (assignErr) throw assignErr;
    const assigned = new Set((assignRows ?? []).map((r) => r.deck_id as string));

    const { data, error } = await supabase
      .from('card_states')
      .select(`
        ${CARD_STATE_COLS},
        card:cards!inner(
          ${CARD_COLS},
          deck:decks!inner(${DECK_COLS})
        )
      `)
      .eq('child_id', childId);
    if (error) throw error;

    type Row = CardState & { card: Card & { deck: Deck } };
    const pool = ((data as unknown as Row[]) ?? [])
      .map((row) => {
        const { card, ...stateFields } = row;
        const { deck, ...cardFields } = card;
        return { ...stateFields, card: cardFields, deck };
      })
      .filter(
        (row) =>
          assigned.has(row.deck.id) &&
          isPermanentBucket(row.bucket_index, row.deck.bucket_intervals_days),
      );
    // A miss drops a card to bucket 0, so a card answered today can leave `pool`
    // and stop counting against the day's budget — which refunds its slot and lets
    // the lottery draw a replacement. bucket_before on the review says where the
    // card was, so count the ones that left from there. Same coarse 1-day window
    // + exact tz-date filter as resetTodaysReviewsForChild.
    const sinceIso = `${addDays(todayInTz(timezone), -1)}T00:00:00.000Z`;
    const { data: recent, error: revErr } = await supabase
      .from('reviews')
      .select('card_id, reviewed_at, bucket_before, card:cards!inner(deck:decks!inner(id, bucket_intervals_days))')
      .eq('child_id', childId)
      .gte('reviewed_at', sinceIso);
    if (revErr) throw revErr;

    const realToday = todayInTz(timezone);
    const inPool = new Set(pool.map((r) => r.card_id));
    const exited = new Set(
      ((recent ?? []) as unknown as {
        card_id: string;
        reviewed_at: string;
        bucket_before: number;
        card: { deck: { id: string; bucket_intervals_days: number[] } };
      }[])
        .filter(
          (r) =>
            !inPool.has(r.card_id) &&
            assigned.has(r.card.deck.id) &&
            isPermanentBucket(r.bucket_before, r.card.deck.bucket_intervals_days) &&
            todayInTz(timezone, new Date(r.reviewed_at)) === realToday,
        )
        .map((r) => r.card_id),
    );

    return pickPermanentDraws(
      pool,
      child.permanent_draws_per_day,
      today,
      `keeper:${childId}:${today}`,
      exited.size,
    );
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
    // Restoring it restores permanence too, since permanent is just the last
    // bucket — a fresh graduation is undone and an established permanent card
    // stays permanent, with no separate flag to reconcile.
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
          last_tested_on: null, // force due again for the rest of today
          consecutive_passes_in_top_bucket: 0,
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
