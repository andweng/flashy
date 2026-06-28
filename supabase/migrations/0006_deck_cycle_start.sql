-- Move the Leitner cycle anchor from per-child to per-(child, deck): each deck a
-- child works has its own "what day am I on". Replaces children.cycle_start_date
-- (added in 0005). "Apply day N" reschedules only that deck's cards for that child.
alter table deck_assignments add column cycle_start_date date;

-- Preserve any per-child anchor from the previous design: seed every one of that
-- child's deck assignments with their (single) child-level start date.
update deck_assignments da
  set cycle_start_date = c.cycle_start_date
  from children c
  where da.child_id = c.id and c.cycle_start_date is not null;

alter table children drop column cycle_start_date;
