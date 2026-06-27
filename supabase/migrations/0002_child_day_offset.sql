-- Per-child day offset: how many days into their Leitner cycle a child is.
-- Shifts that child's "effective today" forward (used when migrating a child
-- in mid-cycle from another app). Replaces the former app-global day offset,
-- so it no longer affects every child at once.
alter table children
  add column day_offset int not null default 0
  check (day_offset >= 0);
