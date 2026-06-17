import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/db';
import { parseDeckExport } from '@/lib/deck-export';

export default function ImportDeckScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const data = parseDeckExport(text);
      const parent = await db.getCurrentParent();
      if (!parent) throw new Error('Not signed in.');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Import deck</ThemedText>
          <ThemedText themeColor="textSecondary">
            Paste a share code (JSON) from another Flashy user. Cards land in your account fresh —
            no review history carries over.
          </ThemedText>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Paste here…"
            placeholderTextColor={theme.textSecondary}
            multiline
            editable={!pending}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
          />
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          <Pressable
            style={[styles.submit, (!text.trim() || pending) && styles.submitDisabled]}
            onPress={submit}
            disabled={!text.trim() || pending}>
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
  input: {
    fontSize: 13,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
    minHeight: 240,
    textAlignVertical: 'top',
    fontFamily: 'monospace',
  },
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
