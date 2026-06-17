import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCurrentChild } from '@/lib/current-child';

export default function SettingsScreen() {
  const { child } = useCurrentChild();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ThemedText type="title">Settings</ThemedText>
        {child && (
          <ThemedView type="backgroundElement" style={styles.row}>
            <ThemedText>Profile: {child.display_name}</ThemedText>
            <ThemedText themeColor="textSecondary" type="small">
              Graduate after passes: {child.graduate_after_passes ?? '∞ (stay in top bucket)'}
            </ThemedText>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  row: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.one },
});
