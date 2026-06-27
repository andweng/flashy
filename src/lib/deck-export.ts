// Serializable deck format for sharing between parents.
// Versioned so we can evolve the schema later without breaking older exports.

import type { Card, Deck, GradingMode } from '@/types/domain';

const GRADING_MODES: readonly GradingMode[] = ['self_grade', 'typed', 'multiple_choice'];

export const DECK_EXPORT_FORMAT = 'flashy-deck' as const;
export const DECK_EXPORT_VERSION = 1 as const;

export type DeckExport = {
  format: typeof DECK_EXPORT_FORMAT;
  version: typeof DECK_EXPORT_VERSION;
  deck: {
    name: string;
    description: string | null;
    bucket_intervals_days: number[];
  };
  cards: {
    front: string;
    back: string;
    grading_mode: GradingMode;
    typed_alternates: string[];
    choices: string[];
  }[];
};

export function serializeDeck(deck: Deck, cards: Card[]): string {
  const payload: DeckExport = {
    format: DECK_EXPORT_FORMAT,
    version: DECK_EXPORT_VERSION,
    deck: {
      name: deck.name,
      description: deck.description,
      bucket_intervals_days: deck.bucket_intervals_days,
    },
    cards: cards.map((c) => ({
      front: c.front,
      back: c.back,
      grading_mode: c.grading_mode,
      typed_alternates: c.typed_alternates,
      choices: c.choices,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseDeckExport(text: string): DeckExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  const obj = data as Record<string, unknown>;
  if (obj?.format !== DECK_EXPORT_FORMAT) throw new Error('Not a Flashy deck export.');
  if (obj.version !== DECK_EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${String(obj.version)}`);
  }
  const deckIn = obj.deck as Record<string, unknown> | undefined;
  if (!deckIn || typeof deckIn.name !== 'string' || deckIn.name.trim() === '') {
    throw new Error('Export is missing a deck name.');
  }
  if (!Array.isArray(obj.cards)) throw new Error('Export "cards" must be an array.');

  for (const c of obj.cards) {
    const card = c as Record<string, unknown>;
    if (typeof card.front !== 'string' || typeof card.back !== 'string') {
      throw new Error('Each card must have string front and back.');
    }
    if (!GRADING_MODES.includes(card.grading_mode as GradingMode)) {
      throw new Error('Each card grading_mode must be "self_grade", "typed", or "multiple_choice".');
    }
  }

  return {
    format: DECK_EXPORT_FORMAT,
    version: DECK_EXPORT_VERSION,
    deck: {
      name: (deckIn.name as string).trim(),
      description: typeof deckIn.description === 'string' ? deckIn.description : null,
      bucket_intervals_days: Array.isArray(deckIn.bucket_intervals_days)
        ? (deckIn.bucket_intervals_days as number[])
        : [1, 2, 4, 8, 16],
    },
    cards: (obj.cards as Record<string, unknown>[]).map((c) => ({
      front: c.front as string,
      back: c.back as string,
      grading_mode: c.grading_mode as GradingMode,
      typed_alternates: Array.isArray(c.typed_alternates) ? (c.typed_alternates as string[]) : [],
      choices: Array.isArray(c.choices) ? (c.choices as string[]) : [],
    })),
  };
}
