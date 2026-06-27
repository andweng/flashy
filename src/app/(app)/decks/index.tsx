import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
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

  async function toggleAssign(deck: Deck, current: boolean) {
    if (!child) return;
    if (current) await db.unassignDeckFromChild(deck.id, child.id);
    else await db.assignDeckToChild(deck.id, child.id);
    setRows((rs) => rs?.map((r) => (r.deck.id === deck.id ? { ...r, assigned: !current } : r)) ?? null);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <ThemedText type="title">Decks</ThemedText>
          <View style={styles.headerActions}>
            <Link href="/decks/import" asChild>
              <Pressable>
                <ThemedText themeColor="textSecondary">Import</ThemedText>
              </Pressable>
            </Link>
            <Link href="/decks/new" asChild>
              <Pressable>
                <ThemedText themeColor="textSecondary">+ New</ThemedText>
              </Pressable>
            </Link>
          </View>
        </View>

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
            {rows?.length === 0 && (
              <ThemedText themeColor="textSecondary">
                No decks yet — create one to get started.
              </ThemedText>
            )}

            {rows?.map(({ deck, assigned, cardCount }) => (
              <ThemedView key={deck.id} type="backgroundElement" style={styles.row}>
                <Pressable style={styles.rowMain} onPress={() => router.push(`/decks/${deck.id}`)}>
                  <ThemedText>{deck.name}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {cardCount} card{cardCount === 1 ? '' : 's'}
                    {child && (assigned ? ` · in ${child.display_name}'s rotation` : '')}
                  </ThemedText>
                </Pressable>
                {child && (
                  <Switch value={assigned} onValueChange={() => toggleAssign(deck, assigned)} />
                )}
              </ThemedView>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  headerActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
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
});
