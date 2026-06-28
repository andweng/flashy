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
  graduate_after_passes: number | null;
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
  bucket_index: number;
  next_due_on: string;
  consecutive_passes_in_top_bucket: number;
  graduated_at: string | null;
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
