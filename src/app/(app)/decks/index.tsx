import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import type { Deck } from '@/types/domain';

type Row = { deck: Deck; assigned: boolean; cardCount: number };
// Flat index of every card front across all decks, for the live search.
type CardHit = { cardId: string; front: string; deckId: string; deckName: string };

export default function DecksScreen() {
  const { child } = useCurrentChild();
  const router = useRouter();
  const theme = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [index, setIndex] = useState<CardHit[]>([]);
  const [query, setQuery] = useState('');
  // Inline picker for enabling a deck the parent owns but isn't in rotation.
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  // Two-tap confirm before removing a deck from rotation (id of the armed deck).
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const parent = await db.getCurrentParent();
        if (!parent) {
          if (!cancelled) {
            setRows([]);
            setIndex([]);
          }
          return;
        }
        const decks = await db.listDecksForParent(parent.id);
        const built: Row[] = [];
        const cardIndex: CardHit[] = [];
        for (const deck of decks) {
          const [assignedIds, cards] = await Promise.all([
            db.listDeckAssignments(deck.id),
            db.listCardsInDeck(deck.id),
          ]);
          built.push({
            deck,
            assigned: child ? assignedIds.includes(child.id) : false,
            cardCount: cards.length,
          });
          for (const c of cards) {
            cardIndex.push({ cardId: c.id, front: c.front, deckId: deck.id, deckName: deck.name });
          }
        }
        if (!cancelled) {
          setRows(built);
          setIndex(cardIndex);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [child]),
  );

  const q = query.trim().toLowerCase();
  const hits = useMemo(
    () => (q ? index.filter((h) => h.front.toLowerCase().includes(q)) : []),
    [q, index],
  );
  const deckHitCount = useMemo(() => new Set(hits.map((h) => h.deckId)).size, [hits]);

  const activeRows = rows?.filter((r) => r.assigned) ?? [];
  const inactiveRows = rows?.filter((r) => !r.assigned) ?? [];

  async function enableDeck(deck: Deck) {
    if (!child) return;
    await db.assignDeckToChild(deck.id, child.id);
    setRows((rs) => rs?.map((r) => (r.deck.id === deck.id ? { ...r, assigned: true } : r)) ?? null);
  }

  // First tap arms the confirm; second tap actually removes it from rotation.
  async function removeFromRotation(deck: Deck) {
    if (!child) return;
    if (confirmingRemoveId !== deck.id) {
      setConfirmingRemoveId(deck.id);
      return;
    }
    setConfirmingRemoveId(null);
    await db.unassignDeckFromChild(deck.id, child.id);
    setRows((rs) => rs?.map((r) => (r.deck.id === deck.id ? { ...r, assigned: false } : r)) ?? null);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ThemedText type="title">Decks</ThemedText>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search cards across all decks"
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { color: theme.text, borderColor: theme.textSecondary }]}
        />

        {q ? (
          <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
            <ThemedText themeColor="textSecondary" type="small">
              {hits.length} hit{hits.length === 1 ? '' : 's'} across {deckHitCount} deck
              {deckHitCount === 1 ? '' : 's'}
            </ThemedText>
            {hits.map((h) => (
              <ThemedView key={h.cardId} type="backgroundElement" style={styles.row}>
                <Pressable style={styles.rowMain} onPress={() => router.push(`/decks/${h.deckId}`)}>
                  <ThemedText>{h.front}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {h.deckName}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
            {rows != null &&
              (activeRows.length === 0 ? (
                <ThemedText themeColor="textSecondary">
                  No active decks yet. Add, import, or create one below.
                </ThemedText>
              ) : (
                activeRows.map(({ deck, cardCount }) => (
                  <ThemedView key={deck.id} type="backgroundElement" style={styles.row}>
                    <Pressable style={styles.rowMain} onPress={() => router.push(`/decks/${deck.id}`)}>
                      <ThemedText>{deck.name}</ThemedText>
                      <ThemedText themeColor="textSecondary" type="small">
                        {cardCount} card{cardCount === 1 ? '' : 's'}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => removeFromRotation(deck)}
                      hitSlop={8}
                      style={styles.removeBtn}>
                      {confirmingRemoveId === deck.id ? (
                        <ThemedText type="small" style={styles.removeConfirmText}>
                          Tap to confirm
                        </ThemedText>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                          Remove
                        </ThemedText>
                      )}
                    </Pressable>
                  </ThemedView>
                ))
              ))}

            {/* Add decks */}
            <View style={styles.addSection}>
              <ThemedText type="smallBold">Add decks</ThemedText>

              <Pressable onPress={() => setAddExistingOpen((v) => !v)} style={styles.actionBtn}>
                <ThemedText>Add existing deck {addExistingOpen ? '▾' : '▸'}</ThemedText>
              </Pressable>
              {addExistingOpen &&
                (inactiveRows.length === 0 ? (
                  <ThemedText themeColor="textSecondary" type="small" style={styles.addHint}>
                    No other decks — import or create one below.
                  </ThemedText>
                ) : (
                  inactiveRows.map(({ deck, cardCount }) => (
                    <ThemedView key={deck.id} type="backgroundElement" style={styles.row}>
                      <Pressable
                        style={styles.rowMain}
                        onPress={() => router.push(`/decks/${deck.id}`)}>
                        <ThemedText>{deck.name}</ThemedText>
                        <ThemedText themeColor="textSecondary" type="small">
                          {cardCount} card{cardCount === 1 ? '' : 's'}
                        </ThemedText>
                      </Pressable>
                      <Pressable onPress={() => enableDeck(deck)} style={styles.enableBtn}>
                        <ThemedText style={styles.enableBtnText}>Add</ThemedText>
                      </Pressable>
                    </ThemedView>
                  ))
                ))}

              <Link href="/decks/import" asChild>
                <Pressable style={styles.actionBtn}>
                  <ThemedText>Import deck (JSON or CSV)</ThemedText>
                </Pressable>
              </Link>
              <Link href="/decks/new" asChild>
                <Pressable style={[styles.actionBtn, styles.actionPrimary]}>
                  <ThemedText style={styles.actionPrimaryText}>Create new deck</ThemedText>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  results: { gap: Spacing.three, paddingBottom: Spacing.four },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.three,
  },
  rowMain: { flex: 1, gap: Spacing.one },
  removeBtn: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.two },
  removeConfirmText: { color: '#d2433f', fontWeight: '600' },
  addSection: { gap: Spacing.two, marginTop: Spacing.two },
  actionBtn: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#888',
  },
  actionPrimary: { backgroundColor: '#3c87f7', borderColor: '#3c87f7' },
  actionPrimaryText: { color: '#ffffff', fontWeight: '600' },
  addHint: { paddingHorizontal: Spacing.one },
  enableBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    backgroundColor: '#3c87f720',
    borderWidth: 1,
    borderColor: '#3c87f7',
  },
  enableBtnText: { color: '#3c87f7', fontWeight: '600' },
});
