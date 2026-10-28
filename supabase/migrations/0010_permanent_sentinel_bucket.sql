-- Permanent becomes a sentinel bucket instead of a separate flag. Previously a
-- card had two overlapping pieces of state (card_states.permanent_at timestamp
-- AND bucket_index); now a card is either in a bucket (>= 0) or permanent
-- (bucket_index = -1, see PERMANENT_BUCKET in src/lib/leitner.ts), never both.
--
-- Existing permanent cards move to bucket -1; their old bucket is discarded
-- (a permanent card that fails drops to bucket 0 regardless).
--
-- reviews.was_permanent_before becomes redundant: a card that was permanent
-- before a review has bucket_before = -1, so "reset today" restores it from
-- bucket_before alone. Old reviews rows that recorded a permanent card keep
-- their pre-migration bucket_before; that only matters for reviews made today.
--
-- 0008's reclamp (bucket_index > top_index) is unaffected: -1 is never above it.

-- (1) Allow the -1 sentinel. 0001 declared the check inline, so Postgres named
-- it card_states_bucket_index_check.
alter table card_states drop constraint card_states_bucket_index_check;
alter table card_states add constraint card_states_bucket_index_check
  check (bucket_index >= -1);

-- (2) Fold permanent_at into the sentinel.
update card_states set bucket_index = -1 where permanent_at is not null;

-- (3) The live-cards index was partial on permanent_at is null; it must go
-- before the column can be dropped.
drop index if exists card_states_live_idx;
alter table card_states drop column permanent_at;

-- (4) Same index as 0007, now partial on the sentinel.
create index card_states_live_idx on card_states (child_id)
  where bucket_index >= 0;

-- (5) No longer needed (see above).
alter table reviews drop column was_permanent_before;
