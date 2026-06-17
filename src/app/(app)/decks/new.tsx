import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/db';
import { bucketLetter, parseIntervalsList } from '@/lib/leitner';

const DOUBLING = '1, 2, 4, 8, 16';
const FIBONACCI = '1, 2, 3, 5, 8';

export default function NewDeckScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [intervalsInput, setIntervalsInput] = useState(DOUBLING);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const trimmed = intervalsInput.trim();
    if (!trimmed) {
      return { intervals: null as number[] | null, error: 'Enter at least one interval.' };
    }
    try {
      return { intervals: parseIntervalsList(trimmed), error: null as string | null };
    } catch (e) {
      return { intervals: null, error: e instanceof Error ? e.message : 'Could not parse.' };
    }
  }, [intervalsInput]);

  const canSubmit = !pending && name.trim().length > 0 && !!parsed.intervals;

  async function submit() {
    if (!parsed.intervals) {
      setError(parsed.error ?? 'Intervals are invalid.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const parent = await db.getCurrentParent();
      if (!parent) throw new Error('No parent session.');
      const deck = await db.createDeck({
        parent_id: parent.id,
        name: name.trim(),
        description: description.trim() || null,
        bucket_intervals_days: parsed.intervals,
      });
      router.replace(`/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'New deck' }} />
      <SafeAreaView style={styles.safe}>
        <ThemedText type="title">New deck</ThemedText>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name (e.g. Math facts)"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          editable={!pending}
          style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor={theme.textSecondary}
          editable={!pending}
          multiline
          style={[styles.input, styles.multiline, { color: theme.text, borderColor: theme.textSecondary }]}
        />

        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">Schedule</ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            Days between reviews for each bucket. Comma- or space-separated. 2–10 values.
          </ThemedText>
          <View style={styles.presetRow}>
            <Pressable onPress={() => setIntervalsInput(DOUBLING)} style={styles.presetChip}>
              <ThemedText type="small">Doubling</ThemedText>
            </Pressable>
            <Pressable onPress={() => setIntervalsInput(FIBONACCI)} style={styles.presetChip}>
              <ThemedText type="small">Fibonacci</ThemedText>
            </Pressable>
          </View>
          <TextInput
            value={intervalsInput}
            onChangeText={setIntervalsInput}
            placeholder="1, 2, 4, 8, 16"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.textSecondary, fontFamily: 'monospace' },
            ]}
          />
          {parsed.error && (
            <ThemedText style={styles.error} type="small">{parsed.error}</ThemedText>
          )}
          {parsed.intervals && (
            <View style={styles.intervalsRow}>
              {parsed.intervals.map((d, i) => (
                <ThemedView key={i} type="backgroundSelected" style={styles.intervalChip}>
                  <ThemedText type="small">{bucketLetter(i)}: every {d}d</ThemedText>
                </ThemedView>
              ))}
            </View>
          )}
        </ThemedView>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          onPress={submit}
          disabled={!canSubmit}>
          <ThemedText style={styles.submitText}>{pending ? '…' : 'Create deck'}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  presetRow: { flexDirection: 'row', gap: Spacing.two },
  presetChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  intervalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  intervalChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  submit: {
    marginTop: Spacing.three,
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  error: { color: '#d2433f' },
});
