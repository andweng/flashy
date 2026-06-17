import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/db';
import { DEFAULT_BUCKET_INTERVALS } from '@/lib/leitner';

export default function NewDeckScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const parent = await db.getCurrentParent();
      if (!parent) throw new Error('No parent session.');
      const deck = await db.createDeck({
        parent_id: parent.id,
        name: trimmed,
        description: description.trim() || null,
        bucket_intervals_days: [...DEFAULT_BUCKET_INTERVALS],
      });
      router.replace(`/decks/${deck.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
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

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          style={[styles.submit, pending && styles.submitDisabled]}
          onPress={submit}
          disabled={pending}>
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
    fontSize: 18,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
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
