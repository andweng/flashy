// Domain types — mirror the Postgres schema in supabase/migrations/0001_initial_schema.sql.

export type Parent = {
  id: string;
  display_name: string | null;
  timezone: string;
};

export type Child = {
  id: string;
  parent_id: string;
  display_name: string;
  avatar: string | null;
  // Mastery threshold: after this many consecutive top-bucket passes a card
  // graduates into the deck's permanent bucket (null = never graduate, cards
  // cycle forever in the top interval bucket).
  graduate_after_passes: number | null;
  // Daily permanent-bucket lottery size: up to this many permanent cards are
  // drawn for review each day (weighted by days since last test; see
  // pickPermanentDraws in leitner.ts). 0 = never re-test permanent cards
  // (effectively retired).
  permanent_draws_per_day: number;
};

// One child's enrollment in one deck. cycle_start_date is the per-(child, deck)
// Leitner anchor (null = fresh start / day 0); current cycle day =
// daysBetween(cycle_start_date, realToday).
export type DeckAssignment = {
  deck_id: string;
  child_id: string;
  cycle_start_date: string | null;
};

export type Deck = {
  id: string;
  parent_id: string;
  name: string;
  description: string | null;
  bucket_intervals_days: number[];
};

export type GradingMode = 'self_grade' | 'typed' | 'multiple_choice';

export type Card = {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  grading_mode: GradingMode;
  typed_alternates: string[];
  // For multiple_choice cards: the options shown (including the correct one,
  // which is `back`). Empty for other modes.
  choices: string[];
};

export type CardState = {
  child_id: string;
  card_id: string;
  // Which bucket the card sits in. The last index (= the deck's interval count)
  // is the permanent bucket — off the grid, re-tested by the daily lottery. See
  // "the permanent bucket" in leitner.ts.
  bucket_index: number;
  // Scheduling anchor (see leitner.ts "last_tested_on model"). Due-ness is derived
  // from this + bucket + the deck's cycle start; there is no stored due date.
  // null ⇒ "force due now" (a fresh bucket-0 card, or a card cleared by a reset).
  last_tested_on: string | null;
  consecutive_passes_in_top_bucket: number;
  last_reviewed_at: string | null;
};

export type ReviewOutcome = 'pass' | 'fail';

export type Review = {
  id: number;
  child_id: string;
  card_id: string;
  reviewed_at: string;
  outcome: ReviewOutcome;
  bucket_before: number;
  bucket_after: number;
  user_input: string | null;
};
