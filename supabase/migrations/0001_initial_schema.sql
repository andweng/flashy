-- ============================================================
-- Flashy: initial schema
-- Leitner-style flashcard app for families (parent + child profiles)
-- ============================================================

create extension if not exists pgcrypto;

-- ----- Parents (extends Supabase auth.users) -----
-- One row per authenticated user. Auto-created by handle_new_user() trigger below.
create table parents (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  -- IANA timezone (e.g. 'America/Los_Angeles'). Used to define "today" for due-date math.
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

-- ----- Children (profiles under a parent) -----
create table children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id) on delete cascade,
  display_name text not null,
  avatar text,
  -- Threshold for graduating a card out of the top bucket.
  -- null = stay in top bucket forever (default).
  graduate_after_passes int check (graduate_after_passes is null or graduate_after_passes >= 1),
  created_at timestamptz not null default now()
);
create index children_parent_idx on children (parent_id);

-- ----- Decks (owned by a parent) -----
create table decks (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id) on delete cascade,
  name text not null,
  description text,
  -- Per-deck bucket intervals in days. Length = number of buckets.
  -- Default = classic Leitner doubling for 5 buckets (A..E).
  bucket_intervals_days int[] not null default array[1,2,4,8,16],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(bucket_intervals_days) between 2 and 10)
);
create index decks_parent_idx on decks (parent_id);

-- ----- Deck assignments (which children use which decks) -----
create table deck_assignments (
  deck_id uuid not null references decks(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (deck_id, child_id)
);
create index deck_assignments_child_idx on deck_assignments (child_id);

-- ----- Cards -----
create table cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks(id) on delete cascade,
  front text not null,
  back text not null,
  grading_mode text not null check (grading_mode in ('self_grade','typed')),
  -- Optional acceptable alternates for typed grading (case/punct normalization in app code).
  typed_alternates text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cards_deck_idx on cards (deck_id);

-- ----- Card state per (child, card) -----
-- One row per child/card pair, created when a deck is assigned to a child.
-- bucket_index is 0-indexed (0 = A, 1 = B, ...). UI maps to letters.
create table card_states (
  child_id uuid not null references children(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  bucket_index int not null default 0 check (bucket_index >= 0),
  next_due_on date not null default current_date,
  consecutive_passes_in_top_bucket int not null default 0,
  graduated_at timestamptz,
  last_reviewed_at timestamptz,
  primary key (child_id, card_id)
);
-- Daily-review query: "due cards for child X today".
create index card_states_due_idx on card_states (child_id, next_due_on)
  where graduated_at is null;

-- ----- Reviews log (append-only history) -----
create table reviews (
  id bigserial primary key,
  child_id uuid not null references children(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  outcome text not null check (outcome in ('pass','fail')),
  bucket_before int not null,
  bucket_after int not null,
  -- What the child typed (for typed-mode cards); null for self-grade.
  user_input text
);
create index reviews_child_card_idx on reviews (child_id, card_id, reviewed_at desc);

-- ============================================================
-- Row-Level Security
-- Parent owns everything reachable from their auth.uid().
-- Children have no auth identity; the parent's session governs all child data.
-- ============================================================

alter table parents enable row level security;
create policy parents_self on parents
  for all using (id = auth.uid()) with check (id = auth.uid());

alter table children enable row level security;
create policy children_own on children
  for all using (parent_id = auth.uid()) with check (parent_id = auth.uid());

alter table decks enable row level security;
create policy decks_own on decks
  for all using (parent_id = auth.uid()) with check (parent_id = auth.uid());

alter table deck_assignments enable row level security;
create policy deck_assignments_own on deck_assignments
  for all using (
    exists (select 1 from decks d where d.id = deck_assignments.deck_id and d.parent_id = auth.uid())
  ) with check (
    exists (select 1 from decks d where d.id = deck_assignments.deck_id and d.parent_id = auth.uid())
  );

alter table cards enable row level security;
create policy cards_own on cards
  for all using (
    exists (select 1 from decks d where d.id = cards.deck_id and d.parent_id = auth.uid())
  ) with check (
    exists (select 1 from decks d where d.id = cards.deck_id and d.parent_id = auth.uid())
  );

alter table card_states enable row level security;
create policy card_states_own on card_states
  for all using (
    exists (select 1 from children c where c.id = card_states.child_id and c.parent_id = auth.uid())
  ) with check (
    exists (select 1 from children c where c.id = card_states.child_id and c.parent_id = auth.uid())
  );

alter table reviews enable row level security;
create policy reviews_own on reviews
  for all using (
    exists (select 1 from children c where c.id = reviews.child_id and c.parent_id = auth.uid())
  ) with check (
    exists (select 1 from children c where c.id = reviews.child_id and c.parent_id = auth.uid())
  );

-- ============================================================
-- Auto-create a parents row when a new auth user signs up
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parents (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
