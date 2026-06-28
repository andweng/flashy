-- One-time cleanup: delete card_states that belong to a (child, deck) pair the
-- child is no longer assigned to. These accumulate because unassigning a deck
-- keeps its card_states (to preserve progress on re-assign) and the deck editor
-- can create states for unassigned decks. The app already filters these out of
-- review, but this physically clears the backlog.
delete from card_states cs
using cards c
where cs.card_id = c.id
  and not exists (
    select 1
    from deck_assignments da
    where da.deck_id = c.deck_id
      and da.child_id = cs.child_id
  );
