import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AVATARS } from '@/lib/avatars';
import { db } from '@/lib/db';

export default function AddChildScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a name.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const parent = await db.getCurrentParent();
      if (!parent) throw new Error('No parent session.');
      await db.createChild({
        parent_id: parent.id,
        display_name: trimmed,
        avatar,
        graduate_after_passes: null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPending(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ThemedText type="title">Add child</ThemedText>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={theme.textSecondary}
          autoFocus
          editable={!pending}
          style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        />

        <ThemedText themeColor="textSecondary" type="small">Pick an avatar</ThemedText>
        <View style={styles.avatarGrid}>
          {AVATARS.map((emoji) => {
            const selected = avatar === emoji;
            return (
              <Pressable
                key={emoji}
                onPress={() => setAvatar(emoji)}
                style={[
                  styles.avatarChoice,
                  selected && { borderColor: theme.text, borderWidth: 2 },
                ]}>
                <ThemedText style={styles.avatarChoiceText}>{emoji}</ThemedText>
              </Pressable>
            );
          })}
        </View>

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        <Pressable
          style={[styles.submit, pending && styles.submitDisabled]}
          onPress={submit}
          disabled={pending}>
          <ThemedText style={styles.submitText}>{pending ? '…' : 'Create'}</ThemedText>
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
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  avatarChoice: {
    width: 56,
    height: 56,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  avatarChoiceText: { fontSize: 36 },
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
