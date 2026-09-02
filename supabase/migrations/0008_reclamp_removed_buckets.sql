-- Bucket removal: when a deck's bucket list shrinks, cards in the removed
-- buckets move down to the new top bucket (index = length-1). Future edits
-- enforce this in updateDeck() (see src/lib/db/supabase.ts and mock.ts), which
-- re-clamps bucket_index for exactly this case.
--
-- One-time backfill: repair card_states left out of range under the old
-- implicit "treated as the top bucket" behavior, where an out-of-range
-- bucket_index made the card due daily (interval fallback ?? 1) while it
-- counted as top for graduation. Clamping fixes both at once; last_tested_on
-- and the pass counter are untouched, so due-ness and graduation progress
-- carry over onto the new bucket's grid.
with deck_top as (
  select c.id as card_id,
         cardinality(d.bucket_intervals_days) - 1 as top_index
  from cards c
  join decks d on d.id = c.deck_id
)
update card_states cs
  set bucket_index = dt.top_index
  from deck_top dt
  where cs.card_id = dt.card_id
    and cs.bucket_index > dt.top_index;
