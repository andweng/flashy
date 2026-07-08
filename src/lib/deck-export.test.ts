// Locks the deck share-code format: serialize/parse round-trips and the
// validation parseDeckExport enforces on untrusted input.

import {
  DECK_EXPORT_FORMAT,
  DECK_EXPORT_VERSION,
  parseDeckExport,
  serializeDeck,
} from '@/lib/deck-export';
import type { Card, Deck } from '@/types/domain';

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    parent_id: 'p1',
    name: 'Spanish',
    description: 'Basics',
    bucket_intervals_days: [1, 2, 4, 8, 16],
    ...overrides,
  };
}

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    deck_id: 'deck-1',
    front: 'hola',
    back: 'hello',
    grading_mode: 'typed',
    typed_alternates: ['hi'],
    choices: [],
    ...overrides,
  };
}

describe('serializeDeck', () => {
  it('emits the format/version envelope and strips db-only fields', () => {
    const parsed = JSON.parse(serializeDeck(makeDeck(), [makeCard()]));
    expect(parsed.format).toBe(DECK_EXPORT_FORMAT);
    expect(parsed.version).toBe(DECK_EXPORT_VERSION);
    expect(parsed.deck).toEqual({
      name: 'Spanish',
      description: 'Basics',
      bucket_intervals_days: [1, 2, 4, 8, 16],
    });
    // No id / deck_id leak into the shared payload.
    expect(parsed.cards[0]).not.toHaveProperty('id');
    expect(parsed.cards[0]).not.toHaveProperty('deck_id');
  });
});

describe('serialize → parse round-trip', () => {
  it('preserves deck fields and every card field', () => {
    const deck = makeDeck({ description: null, bucket_intervals_days: [1, 3, 7] });
    const cards = [
      makeCard(),
      makeCard({ front: 'x', back: 'y', grading_mode: 'multiple_choice', typed_alternates: [], choices: ['y', 'z'] }),
    ];
    const out = parseDeckExport(serializeDeck(deck, cards));
    expect(out.deck).toEqual({ name: 'Spanish', description: null, bucket_intervals_days: [1, 3, 7] });
    expect(out.cards).toEqual([
      { front: 'hola', back: 'hello', grading_mode: 'typed', typed_alternates: ['hi'], choices: [] },
      { front: 'x', back: 'y', grading_mode: 'multiple_choice', typed_alternates: [], choices: ['y', 'z'] },
    ]);
  });
});

describe('parseDeckExport — validation', () => {
  const base = () => ({
    format: DECK_EXPORT_FORMAT,
    version: DECK_EXPORT_VERSION,
    deck: { name: 'D', description: null, bucket_intervals_days: [1, 2] },
    cards: [{ front: 'a', back: 'b', grading_mode: 'self_grade', typed_alternates: [], choices: [] }],
  });

  it('rejects non-JSON', () => {
    expect(() => parseDeckExport('{not json')).toThrow(/valid JSON/i);
  });

  it('rejects a wrong format tag', () => {
    expect(() => parseDeckExport(JSON.stringify({ ...base(), format: 'nope' }))).toThrow(
      /not a flashy deck/i,
    );
  });

  it('rejects an unsupported version', () => {
    expect(() => parseDeckExport(JSON.stringify({ ...base(), version: 99 }))).toThrow(
      /unsupported export version/i,
    );
  });

  it('requires a non-empty deck name', () => {
    expect(() => parseDeckExport(JSON.stringify({ ...base(), deck: { name: '  ' } }))).toThrow(
      /missing a deck name/i,
    );
  });

  it('requires cards to be an array', () => {
    expect(() => parseDeckExport(JSON.stringify({ ...base(), cards: 'nope' }))).toThrow(
      /"cards" must be an array/i,
    );
  });

  it('requires string front/back on every card', () => {
    const bad = { ...base(), cards: [{ front: 'a', back: 5, grading_mode: 'typed' }] };
    expect(() => parseDeckExport(JSON.stringify(bad))).toThrow(/string front and back/i);
  });

  it('rejects an unknown grading_mode', () => {
    const bad = { ...base(), cards: [{ front: 'a', back: 'b', grading_mode: 'essay' }] };
    expect(() => parseDeckExport(JSON.stringify(bad))).toThrow(/grading_mode/i);
  });

  it('fills defaults: non-string description → null, missing intervals → classic, missing lists → []', () => {
    const input = {
      format: DECK_EXPORT_FORMAT,
      version: DECK_EXPORT_VERSION,
      deck: { name: '  Trimmed  ' }, // no description / intervals
      cards: [{ front: 'a', back: 'b', grading_mode: 'self_grade' }], // no alternates / choices
    };
    const out = parseDeckExport(JSON.stringify(input));
    expect(out.deck.name).toBe('Trimmed');
    expect(out.deck.description).toBeNull();
    expect(out.deck.bucket_intervals_days).toEqual([1, 2, 4, 8, 16]);
    expect(out.cards[0].typed_alternates).toEqual([]);
    expect(out.cards[0].choices).toEqual([]);
  });
});
