import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseCSVImport } from '@/lib/csv-import';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import { parseDeckExport } from '@/lib/deck-export';
import { DEFAULT_BUCKET_INTERVALS, initialDueDate } from '@/lib/leitner';
import { getEffectiveToday } from '@/lib/today';
import type { GradingMode } from '@/types/domain';

type Format = 'json' | 'csv';

const CSV_EXAMPLE = `front,back,grading_mode,typed_alternates,bucket
"6 × 7",42,self_grade,,B
hola,hello,typed,hi|hey,A
Recite the alphabet,,self_grade,,A`;

export default function ImportDeckScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { child } = useCurrentChild();

  const [format, setFormat] = useState<Format>('json');
  const [text, setText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [deckDescription, setDeckDescription] = useState('');
  const [defaultMode, setDefaultMode] = useState<GradingMode>('self_grade');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !pending &&
    text.trim().length > 0 &&
    (format === 'json' || deckName.trim().length > 0);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const parent = await db.getCurrentParent();
      if (!parent) throw new Error('Not signed in.');

      if (format === 'json') {
        const data = parseDeckExport(text);
        const deck = await db.createDeck({
          parent_id: parent.id,
          name: data.deck.name,
          description: data.deck.description,
          bucket_intervals_days: data.deck.bucket_intervals_days,
        });
        for (const c of data.cards) {
          await db.createCard({
            deck_id: deck.id,
            front: c.front,
            back: c.back,
            grading_mode: c.grading_mode,
            typed_alternates: c.typed_alternates,
          });
        }
        router.replace(`/decks/${deck.id}`);
        return;
      }

      // CSV path
      const cards = parseCSVImport(text, defaultMode);
      const deck = await db.createDeck({
        parent_id: parent.id,
        name: deckName.trim(),
        description: deckDescription.trim() || null,
        bucket_intervals_days: [...DEFAULT_BUCKET_INTERVALS],
      });
      const created: { id: string; bucket?: number }[] = [];
      for (const c of cards) {
        const row = await db.createCard({
          deck_id: deck.id,
          front: c.front,
          back: c.back,
          grading_mode: c.grading_mode,
          typed_alternates: c.typed_alternates,
        });
        created.push({ id: row.id, bucket: c.bucket });
      }

      const hasBuckets = created.some((c) => c.bucket !== undefined);
      if (hasBuckets && child) {
        await db.assignDeckToChild(deck.id, child.id);
        const today = getEffectiveToday();
        for (const c of created) {
          if (c.bucket === undefined) continue;
          await db.upsertCardState({
            child_id: child.id,
            card_id: c.id,
            bucket_index: c.bucket,
            next_due_on: initialDueDate(today, c.bucket, deck.bucket_intervals_days),
            consecutive_passes_in_top_bucket: 0,
            graduated_at: null,
            last_reviewed_at: null,
          });
        }
      }

      router.replace(`/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Import deck' }} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Import deck</ThemedText>

          <View style={styles.formatRow}>
            {(['json', 'csv'] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setFormat(f)}
                style={[styles.formatChip, format === f && styles.formatChipActive]}>
                <ThemedText>{f.toUpperCase()}</ThemedText>
              </Pressable>
            ))}
          </View>

          {format === 'json' ? (
            <>
              <ThemedText themeColor="textSecondary" type="small">
                Paste a JSON share code from another Flashy user&apos;s &quot;Copy share code&quot; button.
                Cards land in your account fresh — no review history carries over.
              </ThemedText>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Paste JSON here…"
                placeholderTextColor={theme.textSecondary}
                multiline
                editable={!pending}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.textSecondary }]}
              />
            </>
          ) : (
            <>
              <ThemedText themeColor="textSecondary" type="small">
                Header row required. Required column: <ThemedText type="code">front</ThemedText>.
                Optional: <ThemedText type="code">back</ThemedText>,{' '}
                <ThemedText type="code">grading_mode</ThemedText>{' '}
                (self_grade | typed), <ThemedText type="code">typed_alternates</ThemedText> (pipe-separated),{' '}
                <ThemedText type="code">bucket</ThemedText> (A–Z or 0-indexed integer).
                {child
                  ? ` Rows with a bucket value will be assigned to ${child.display_name} at that bucket.`
                  : ' (No child profile selected — bucket values will be ignored.)'}
              </ThemedText>

              <TextInput
                value={deckName}
                onChangeText={setDeckName}
                placeholder="Deck name"
                placeholderTextColor={theme.textSecondary}
                editable={!pending}
                style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
              />
              <TextInput
                value={deckDescription}
                onChangeText={setDeckDescription}
                placeholder="Description (optional)"
                placeholderTextColor={theme.textSecondary}
                editable={!pending}
                style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
              />

              <View style={styles.modeRow}>
                <ThemedText themeColor="textSecondary" type="small">Default grading mode:</ThemedText>
                {(['self_grade', 'typed'] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setDefaultMode(m)}
                    style={[styles.modeChip, defaultMode === m && styles.modeChipActive]}>
                    <ThemedText type="small">{m === 'typed' ? 'Typed' : 'Self-grade'}</ThemedText>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Paste CSV here…"
                placeholderTextColor={theme.textSecondary}
                multiline
                editable={!pending}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.textSecondary }]}
              />
              <Pressable onPress={() => setText(CSV_EXAMPLE)}>
                <ThemedText themeColor="textSecondary" type="small">Fill in example</ThemedText>
              </Pressable>
            </>
          )}

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            onPress={submit}
            disabled={!canSubmit}>
            <ThemedText style={styles.submitText}>{pending ? '…' : 'Import'}</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: Spacing.four, gap: Spacing.three },
  formatRow: { flexDirection: 'row', gap: Spacing.two },
  formatChip: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  formatChipActive: { backgroundColor: '#3c87f720', borderColor: '#3c87f7' },
  input: {
    fontSize: 14,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  multiline: {
    minHeight: 200,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
  },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  modeChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  modeChipActive: { backgroundColor: '#3c87f720', borderColor: '#3c87f7' },
  submit: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  error: { color: '#d2433f' },
});
