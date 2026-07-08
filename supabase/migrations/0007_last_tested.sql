-- Replace the forward-looking next_due_on with a backward-looking last_tested_on
-- anchor. Due-ness is now derived in the app from bucket_index + last_tested_on +
-- the deck's cycle start (see src/lib/leitner.ts "last_tested_on scheduling model"):
--   due today  ⇔  last_tested_on IS NULL
--              OR  last_tested_on < mostRecentSlot(bucket, cycleDay)
-- Missed/skipped days roll over as a single due (no more owedReviews backlog), and
-- repositioning a schedule only moves deck_assignments.cycle_start_date — no card
-- rows are rewritten.
--
-- Clean slate: existing cards are treated as fully caught up, so we don't backfill
-- a real history. Bucket-0 cards become due now (NULL); higher buckets are marked
-- "tested as of today" so they wait for their next grid slot.

alter table card_states add column last_tested_on date;

update card_states
  set last_tested_on = case when bucket_index = 0 then null else current_date end;

alter table card_states drop column next_due_on;

-- The daily-review query no longer filters on a stored due date; it pulls a child's
-- live (non-graduated) cards and derives due-ness in app. Swap the next_due_on
-- index for a partial index that keeps that per-child scan cheap.
drop index if exists card_states_due_idx;
create index card_states_live_idx on card_states (child_id)
  where graduated_at is null;
