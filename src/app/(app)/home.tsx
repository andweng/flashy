import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import { owedReviews } from '@/lib/leitner';
import { getEffectiveToday } from '@/lib/today';

type DeckSummary = { id: string; name: string; due: number };

export default function HomeScreen() {
  const { child, setChild } = useCurrentChild();
  const [totalDue, setTotalDue] = useState<number | null>(null);
  const [perDeck, setPerDeck] = useState<DeckSummary[]>([]);

  useEffect(() => {
    if (!child) return;
    void (async () => {
      const parent = await db.getCurrentParent();
      const today = getEffectiveToday(parent?.timezone ?? 'UTC');
      const due = await db.listDueCardStatesForChild(child.id, today);

      const byDeck = new Map<string, DeckSummary>();
      for (const s of due) {
        const owed = owedReviews(s, s.deck, today);
        const existing = byDeck.get(s.deck.id);
        if (existing) existing.due += owed;
        else byDeck.set(s.deck.id, { id: s.deck.id, name: s.deck.name, due: owed });
      }
      const list = [...byDeck.values()].sort((a, b) => b.due - a.due);
      setPerDeck(list);
      setTotalDue(list.reduce((sum, d) => sum + d.due, 0));
    })();
  }, [child]);

  if (!child) return null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <ThemedText type="title">Hi, {child.display_name}!</ThemedText>
          <Pressable onPress={() => setChild(null)}>
            <ThemedText themeColor="textSecondary">Switch</ThemedText>
          </Pressable>
        </View>

        <ThemedText type="subtitle">
          {totalDue == null
            ? '…'
            : totalDue === 0
              ? 'All caught up! 🎉'
              : `${totalDue} card${totalDue === 1 ? '' : 's'} due today`}
        </ThemedText>

        <View style={styles.deckList}>
          {perDeck.map((d) => (
            <ThemedView key={d.id} type="backgroundElement" style={styles.deckRow}>
              <ThemedText>{d.name}</ThemedText>
              <ThemedText themeColor="textSecondary">{d.due} due</ThemedText>
            </ThemedView>
          ))}
        </View>

        <View style={styles.nav}>
          <Link href="/review" asChild>
            <Pressable style={StyleSheet.flatten([styles.button, styles.primary])}>
              <ThemedText style={styles.buttonText}>Start review</ThemedText>
            </Pressable>
          </Link>
          <Link href="/decks" asChild>
            <Pressable style={styles.button}>
              <ThemedText style={styles.buttonText}>Manage decks</ThemedText>
            </Pressable>
          </Link>
          <Link href="/settings" asChild>
            <Pressable style={styles.button}>
              <ThemedText style={styles.buttonText}>Profile</ThemedText>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.four },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deckList: { gap: Spacing.two },
  deckRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  nav: { marginTop: Spacing.three, gap: Spacing.two },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#888',
  },
  primary: { backgroundColor: '#3c87f7', borderColor: '#3c87f7' },
  buttonText: { fontWeight: '600' },
});
