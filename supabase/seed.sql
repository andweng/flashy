-- Flashy: complete current-schema seed
-- Run with:  psql -f seed.sql  |  supabase db reset < seed.sql
-- Idempotent: drops and recreates everything. Safe to run repeatedly.

-- === Extension ===
create extension if not exists pgcrypto;

-- === Drop triggers, functions, and tables ===
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user() cascade;

drop table if exists reviews cascade;
drop table if exists card_states cascade;
drop table if exists deck_assignments cascade;
drop table if exists cards cascade;
drop table if exists children cascade;
drop table if exists decks cascade;
drop table if exists parents cascade;

-- === Parents ===
create table parents (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

-- === Children ===
create table children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id) on delete cascade,
  display_name text not null,
  avatar text,
  -- Mastery threshold: this many consecutive top-interval-bucket passes moves a
  -- card into the deck's permanent bucket. null = never graduate.
  graduate_after_passes int check (graduate_after_passes is null or graduate_after_passes >= 1),
  -- Daily permanent-bucket lottery size. 0 = never re-test permanent cards.
  permanent_draws_per_day int not null default 0 check (permanent_draws_per_day >= 0),
  created_at timestamptz not null default now()
);
create index children_parent_idx on children (parent_id);

-- === Decks ===
create table decks (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id) on delete cascade,
  name text not null,
  description text,
  bucket_intervals_days int[] not null default array[1, 2, 4, 8, 16],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(bucket_intervals_days) between 2 and 10)
);
create index decks_parent_idx on decks (parent_id);

-- === Deck Assignments ===
create table deck_assignments (
  deck_id uuid not null references decks(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  cycle_start_date date,
  primary key (deck_id, child_id)
);
create index deck_assignments_child_idx on deck_assignments (child_id);

-- === Cards ===
create table cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks(id) on delete cascade,
  front text not null,
  back text not null,
  grading_mode text not null check (grading_mode in ('self_grade', 'typed', 'multiple_choice')),
  typed_alternates text[] not null default '{}',
  choices text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cards_deck_idx on cards (deck_id);

-- === Card States ===
create table card_states (
  child_id uuid not null references children(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  -- Index into the deck's buckets. The last index (= cardinality of
  -- bucket_intervals_days) is the PERMANENT bucket: off the interval grid,
  -- re-tested by the daily lottery instead. See "the permanent bucket" in
  -- src/lib/leitner.ts — permanence is this column, not a separate flag.
  bucket_index int not null default 0 check (bucket_index >= 0),
  last_tested_on date,
  consecutive_passes_in_top_bucket int not null default 0,
  last_reviewed_at timestamptz,
  primary key (child_id, card_id)
);
create index card_states_child_idx on card_states (child_id);

-- === Reviews ===
create table reviews (
  id bigserial primary key,
  child_id uuid not null references children(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  outcome text not null check (outcome in ('pass', 'fail')),
  bucket_before int not null,
  bucket_after int not null,
  user_input text
);
create index reviews_child_card_idx on reviews (child_id, card_id, reviewed_at desc);

-- ==== Row-Level Security ===

--- Parents table
alter table parents enable row level security;
create policy parents_self on parents
    for all
    using (id = auth.uid())
    with check (id = auth.uid());

--- Children table
alter table children enable row level security;
create policy children_own on children
    for all
    using (parent_id = auth.uid())
    with check (parent_id = auth.uid());

--- Decks table
alter table decks enable row level security;
create policy decks_own on decks
    for all
    using (parent_id = auth.uid())
    with check (parent_id = auth.uid());

--- Deck assignments table
alter table deck_assignments enable row level security;
create policy deck_assignments_own on deck_assignments
    for all
    using (
        exists (
            select 1 from decks d
            where d.id = deck_assignments.deck_id
              and d.parent_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from decks d
            where d.id = deck_assignments.deck_id
              and d.parent_id = auth.uid()
        )
    );

--- Cards table
alter table cards enable row level security;
create policy cards_own on cards
    for all
    using (
        exists (
            select 1 from decks d
            where d.id = cards.deck_id
              and d.parent_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from decks d
            where d.id = cards.deck_id
              and d.parent_id = auth.uid()
        )
    );

--- Card states table
alter table card_states enable row level security;
create policy card_states_own on card_states
    for all
    using (
        exists (
            select 1 from children c
            where c.id = card_states.child_id
              and c.parent_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from children c
            where c.id = card_states.child_id
              and c.parent_id = auth.uid()
        )
    );

--- Reviews table
alter table reviews enable row level security;
create policy reviews_own on reviews
    for all
    using (
        exists (
            select 1 from children c
            where c.id = reviews.child_id
              and c.parent_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from children c
            where c.id = reviews.child_id
              and c.parent_id = auth.uid()
        )
    );

-- === Auto-create parents row on signup ===
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
    insert into public.parents (id, display_name)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'display_name',
                 split_part(new.email, '@', 1))
    );
    return new;
end;
$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure handle_new_user();
