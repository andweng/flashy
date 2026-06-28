-- Replace the read-time `day_offset` with a calendar-anchored cycle start date.
-- "What day am I on" now repositions a child's schedule (rewrites every card's
-- next_due_on via dueDateForCycleDay) instead of sliding a comparison threshold.
-- A child's current cycle day is derived as (current_date - cycle_start_date);
-- NULL means a fresh start (day 0).
alter table children add column cycle_start_date date;

-- Preserve any in-flight migrated children: a child on day N started N days ago.
update children
  set cycle_start_date = current_date - day_offset
  where day_offset > 0;

alter table children drop column day_offset;
