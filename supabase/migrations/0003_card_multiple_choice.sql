-- Multiple-choice cards. `back` remains the correct answer; `choices` holds the
-- full set of options shown to the learner (including the correct one). Empty
-- for self_grade / typed cards.
alter table cards
  add column choices text[] not null default '{}';

-- Allow the new grading mode.
alter table cards
  drop constraint cards_grading_mode_check;
alter table cards
  add constraint cards_grading_mode_check
  check (grading_mode in ('self_grade', 'typed', 'multiple_choice'));
