-- Permanent stops being a flag and becomes the deck's LAST bucket: index
-- cardinality(bucket_intervals_days), one past the configured intervals.
--
-- The flag allowed states the app should never have been able to express — a
-- permanent card sitting in bucket A — because togglePermanent preserved the
-- card's bucket. It also meant two ways to say the same thing: the deck editor
-- had a bucket picker AND a separate permanent toggle writing the same concept.
-- As a bucket index it is unrepresentable: permanent has no interval, so it can
-- only ever be last, and moving a card in or out of it is an ordinary bucket
-- change (see "the permanent bucket" in src/lib/leitner.ts).
--
-- reviews.was_permanent_before goes too: bucket_before already records where the
-- card was, so "reset today" restoring that bucket restores permanence for free.

-- Permanent cards move to their deck's new last index. Cards above it (left by
-- the old out-of-range behaviour that 0008 repaired) clamp to the top interval.
update card_states cs
  set bucket_index = d.permanent_index
  from (
    select c.id as card_id, cardinality(dk.bucket_intervals_days) as permanent_index
    from cards c
    join decks dk on dk.id = c.deck_id
  ) d
  where cs.card_id = d.card_id
    and cs.permanent_at is not null;

update card_states cs
  set bucket_index = d.permanent_index - 1
  from (
    select c.id as card_id, cardinality(dk.bucket_intervals_days) as permanent_index
    from cards c
    join decks dk on dk.id = c.deck_id
  ) d
  where cs.card_id = d.card_id
    and cs.permanent_at is null
    and cs.bucket_index > d.permanent_index - 1;

-- The partial index keyed off the flag; due-ness is now derived from the bucket
-- against the deck's interval count, which no single-column index can express.
drop index if exists card_states_live_idx;
create index card_states_child_idx on card_states (child_id);

alter table card_states drop column permanent_at;
alter table reviews drop column was_permanent_before;
