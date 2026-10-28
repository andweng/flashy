import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type ConfirmationAction = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

// Mount only while an action is awaiting confirmation, so each prompt starts fresh.
export function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmationAction & { onClose: () => void }) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    if (!inFlight.current) onClose();
  }

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch {
      setError('Could not complete this action. Please try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <ThemedView
          style={styles.dialog}
          accessibilityViewIsModal
          onAccessibilityEscape={cancel}>
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedText type="smallBold" accessibilityRole="header">{title}</ThemedText>
            <ThemedText>{message}</ThemedText>
            {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable accessibilityRole="button" onPress={cancel} disabled={pending} style={styles.button}>
              <ThemedText themeColor="textSecondary">Cancel</ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ busy: pending, disabled: pending }}
              onPress={confirm}
              disabled={pending}
              style={[styles.button, styles.confirmButton, pending && styles.disabled]}>
              <ThemedText style={styles.confirmText}>{pending ? 'Working…' : confirmLabel}</ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    backgroundColor: '#00000080',
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  content: { gap: Spacing.three },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
  button: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  confirmButton: { backgroundColor: '#d2433f' },
  confirmText: { color: '#ffffff', fontWeight: '600' },
  error: { color: '#d2433f' },
  disabled: { opacity: 0.5 },
});
