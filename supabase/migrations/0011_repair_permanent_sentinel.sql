-- Repair for databases that applied the earlier 0010 ("permanent is a bucket"),
-- which stored permanent as the deck's last index, cardinality(bucket_intervals_days),
-- one past the top interval. Those cards render as a phantom bucket F. The
-- shipped 0010 now uses the -1 sentinel (PERMANENT_BUCKET in src/lib/leitner.ts),
-- but Supabase skips a version it has already recorded, so it never ran there.
--
-- Idempotent: on a database that ran the current 0010 every statement is a no-op.

-- (1) Allow the -1 sentinel (the earlier 0010 left the >= 0 check from 0001).
alter table card_states drop constraint if exists card_states_bucket_index_check;
alter table card_states add constraint card_states_bucket_index_check
  check (bucket_index >= -1);

-- (2) Any index past a deck's top interval is a permanent card from the earlier
-- scheme. (0008 already clamped genuinely out-of-range cards to the top bucket.)
update card_states cs
   set bucket_index = -1
  from cards ca
  join decks d on d.id = ca.deck_id
 where ca.id = cs.card_id
   and cs.bucket_index > cardinality(d.bucket_intervals_days) - 1;

-- (3) Leftovers the earlier 0010 would have removed on a database that skipped it.
alter table card_states drop column if exists permanent_at;
alter table reviews drop column if exists was_permanent_before;

-- (4) Live-cards index: the earlier 0010 replaced it with a plain child index.
drop index if exists card_states_child_idx;
drop index if exists card_states_live_idx;
create index card_states_live_idx on card_states (child_id)
  where bucket_index >= 0;
