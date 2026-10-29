// Persists an in-progress review session so a web refresh (or app relaunch)
// resumes on the same card with the same order and pass/fail tally, instead of
// re-shuffling the due cards and restarting at card 1.
//
// The whole queue is snapshotted (card + deck + per-card state), not just the
// ids, so restoring never depends on due-ness — already-answered cards have
// dropped out of the due set but we still need the original order and count to
// keep the progress bar stable. A session is scoped to (child, effective day):
// it only resumes for the same child on the same calendar day, since "today's
// due cards" is the whole premise of a session.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Card, CardState, Deck } from '@/types/domain';

export type ReviewQueueItem = {
  state: CardState;
  card: Card;
  deck: Deck;
  // True for permanent-pool (lottery) draws; absent on pre-feature sessions.
  isPermanent?: boolean;
};

export type PersistedReviewSession = {
  version: 1;
  today: string;
  items: ReviewQueueItem[];
  index: number;
  passes: number;
  fails: number;
};

const keyFor = (childId: string) => `review-session:v1:${childId}`;

// Returns a resumable session for this child+day, or null if none is stored,
// it's from another day, it's malformed, or it already ran to completion.
export async function loadReviewSession(
  childId: string,
  today: string,
): Promise<PersistedReviewSession | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(childId));
    if (!raw) return null;
    const s = JSON.parse(raw) as PersistedReviewSession;
    if (
      s.version !== 1 ||
      s.today !== today ||
      !Array.isArray(s.items) ||
      typeof s.index !== 'number' ||
      s.index >= s.items.length
    ) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

// True iff every card still waiting in the queue (index onward) sits in the same
// bucket in the database as in the snapshot. Answered cards are expected to have
// moved, so they are skipped. A mismatch means the data changed under the saved
// queue (a migration, a reset, another device); finishing it would write stale
// states back, so the caller should discard it and rebuild.
export function isSessionCurrent(
  session: PersistedReviewSession,
  live: Pick<CardState, 'card_id' | 'bucket_index'>[],
): boolean {
  const bucketByCard = new Map(live.map((s) => [s.card_id, s.bucket_index]));
  return session.items
    .slice(session.index)
    .every((item) => bucketByCard.get(item.state.card_id) === item.state.bucket_index);
}

export function saveReviewSession(childId: string, session: PersistedReviewSession): void {
  void AsyncStorage.setItem(keyFor(childId), JSON.stringify(session)).catch(() => {});
}

export function clearReviewSession(childId: string): void {
  void AsyncStorage.removeItem(keyFor(childId)).catch(() => {});
}
