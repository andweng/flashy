-- One-off: promote every card sitting in its deck's TOP INTERVAL bucket into
-- that deck's permanent bucket, for every child.
--
-- Not a migration — migrations run on every deploy, and this rewrites data. Run
-- it by hand, once, from the Supabase SQL editor or psql.
--
-- "Bucket E" is the top interval bucket of a 5-interval deck. This script is
-- written against each deck's own bucket count rather than the literal index 4,
-- so a deck with a different number of tiers promotes its own top bucket rather
-- than a middle one (or nothing). To restrict it to literal E, uncomment the
-- `cardinality(...) = 5` line in both the dry run and the update.
--
-- Permanent is bucket index cardinality(bucket_intervals_days) — see "the
-- permanent bucket" in src/lib/leitner.ts. Promoted cards leave the interval
-- grid and are re-tested by the daily lottery instead, so expect each child's
-- daily due count to drop by roughly what the dry run reports.
--
-- last_tested_on is deliberately left alone. The lottery weights by days since
-- last test, so keeping each card's real date lets the promoted cards enter with
-- honest staleness and spread out naturally. Stamping them all with today would
-- put the whole cohort on the same clock and they would come due together.

-- ─── 1. Dry run: what would move ──────────────────────────────────────────────
select c.display_name,
       d.name as deck,
       cardinality(d.bucket_intervals_days) as tiers,
       count(*) as cards_to_promote
from card_states cs
join cards ca   on ca.id = cs.card_id
join decks d    on d.id = ca.deck_id
join children c on c.id = cs.child_id
where cs.bucket_index = cardinality(d.bucket_intervals_days) - 1
  --  and cardinality(d.bucket_intervals_days) = 5   -- literal "bucket E" only
group by 1, 2, 3
order by 1, 2;

-- ─── 2. The promotion ─────────────────────────────────────────────────────────
begin;

update card_states cs
   set bucket_index = cardinality(d.bucket_intervals_days)
  from cards ca
  join decks d on d.id = ca.deck_id
 where ca.id = cs.card_id
   and cs.bucket_index = cardinality(d.bucket_intervals_days) - 1;
  --  and cardinality(d.bucket_intervals_days) = 5   -- literal "bucket E" only

-- Check the row count against the dry run, then:
commit;
-- ...or `rollback;` if it does not match.

-- ─── 3. After: the permanent pool per child ──────────────────────────────────
-- A pool much larger than permanent_draws_per_day is the healthy case: rotation
-- takes about pool / permanent_draws_per_day days. A pool at or below twice that
-- setting will repeat words every day or two no matter what the lottery does.
select c.display_name,
       c.permanent_draws_per_day as draws_per_day,
       count(*) as permanent_pool,
       round(count(*)::numeric / nullif(c.permanent_draws_per_day, 0), 1) as days_per_rotation
from card_states cs
join cards ca   on ca.id = cs.card_id
join decks d    on d.id = ca.deck_id
join children c on c.id = cs.child_id
where cs.bucket_index >= cardinality(d.bucket_intervals_days)
group by 1, 2
order by 1;
