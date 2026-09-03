-- Graduation becomes a living "permanent" pool: cards that hit the mastery
-- threshold (children.graduate_after_passes top-bucket passes) no longer retire
-- forever — they move to the permanent pool (card_states.permanent_at) and keep
-- being re-tested by a daily weighted lottery (see src/lib/leitner.ts "permanent
-- pool draws").
--
-- Existing graduated cards migrate into the pool untouched. Their daily draw is
-- governed by children.permanent_draws_per_day, which defaults to 0 (never draw)
-- so existing behavior — never re-tested — is preserved until a user opts in.
--
-- The card_states_live_idx partial index (created in 0007 on graduated_at)
-- auto-updates to the renamed column; no index swap needed.

alter table card_states rename column graduated_at to permanent_at;

alter table children
  add column permanent_draws_per_day int not null default 0
  check (permanent_draws_per_day >= 0);

-- Reviews remember whether the card was already permanent BEFORE this review,
-- so "reset today" undoes today's fresh graduations without stripping
-- established permanent cards of their status.
alter table reviews
  add column was_permanent_before boolean not null default false;
