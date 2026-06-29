import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/db';
import { useThemePreference, type ThemePreference } from '@/lib/theme-preference';
import { deviceTimezone, listTimezones } from '@/lib/timezones';

// Light/Dark only for now. The stored default stays 'system' (follows the OS)
// until the parent taps one; the highlighted segment reflects the resolved
// scheme, so something is always selected.
const THEME_OPTIONS: { value: Exclude<ThemePreference, 'system'>; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { preference: themePref, setPreference: setThemePref, colorScheme } = useThemePreference();
  const { changePassword, signOut } = useAuth();

  const [error, setError] = useState<string | null>(null);

  const [tz, setTz] = useState('UTC');
  const [tzModal, setTzModal] = useState(false);
  const [tzQuery, setTzQuery] = useState('');
  const [tzSaving, setTzSaving] = useState(false);
  const [tzFeedback, setTzFeedback] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwFeedback, setPwFeedback] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const allZones = useMemo(() => listTimezones(), []);
  const filteredZones = useMemo(() => {
    const q = tzQuery.trim().toLowerCase();
    return q ? allZones.filter((z) => z.toLowerCase().includes(q)) : allZones;
  }, [allZones, tzQuery]);

  useEffect(() => {
    void (async () => {
      const p = await db.getCurrentParent();
      if (p?.timezone) setTz(p.timezone);
    })();
  }, []);

  async function saveTimezone(next: string) {
    const prev = tz;
    setTz(next);
    setTzModal(false);
    setTzQuery('');
    setTzSaving(true);
    setTzFeedback(null);
    setError(null);
    try {
      await db.updateParent({ timezone: next });
      setTzFeedback('Timezone saved.');
      setTimeout(() => setTzFeedback(null), 2000);
    } catch (e) {
      setTz(prev);
      setError(e instanceof Error ? e.message : 'Could not save timezone.');
    } finally {
      setTzSaving(false);
    }
  }

  async function handleChangePassword() {
    setPwError(null);
    setPwFeedback(null);
    if (newPassword.length < 6) {
      setPwError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPwFeedback('Password changed.');
      setTimeout(() => setPwFeedback(null), 2000);
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Could not change password.');
    } finally {
      setPwSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/');
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText themeColor="textSecondary" type="small">
            These settings apply to your whole account — every child.
          </ThemedText>

          {/* Appearance */}
          <ThemedText type="smallBold">Appearance</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText themeColor="textSecondary" type="small">
              {themePref === 'system' ? 'Following your device. Pick one to override.' : 'Theme'}
            </ThemedText>
            <View style={styles.segmented}>
              {THEME_OPTIONS.map((opt) => {
                const selected = colorScheme === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setThemePref(opt.value)}
                    style={[
                      styles.segment,
                      { borderColor: theme.textSecondary },
                      selected && { backgroundColor: theme.backgroundSelected, borderColor: theme.text },
                    ]}>
                    <ThemedText>{opt.label}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ThemedView>

          {/* Timezone */}
          <ThemedText type="smallBold">Timezone</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText themeColor="textSecondary" type="small">
              Sets when each day rolls over for everyone&apos;s reviews.
            </ThemedText>
            <Pressable
              style={[styles.input, styles.tzRow, { borderColor: theme.textSecondary }]}
              onPress={() => setTzModal(true)}
              disabled={tzSaving}>
              <ThemedText>{tz}</ThemedText>
              <ThemedText themeColor="textSecondary">▾</ThemedText>
            </Pressable>
            <Pressable
              style={styles.outlineBtn}
              onPress={() => saveTimezone(deviceTimezone())}
              disabled={tzSaving}>
              <ThemedText>Use this device&apos;s timezone</ThemedText>
            </Pressable>
            {tzFeedback && (
              <ThemedText themeColor="textSecondary" type="small">{tzFeedback}</ThemedText>
            )}
          </ThemedView>

          {/* Password */}
          <ThemedText type="smallBold">Password</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="New password"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              editable={!pwSaving}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoCapitalize="none"
              editable={!pwSaving}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            {pwError && <ThemedText style={styles.error}>{pwError}</ThemedText>}
            {pwFeedback && (
              <ThemedText themeColor="textSecondary" type="small">{pwFeedback}</ThemedText>
            )}
            <Pressable
              style={[styles.outlineBtn, (pwSaving || !newPassword) && styles.btnDisabled]}
              onPress={handleChangePassword}
              disabled={pwSaving || !newPassword}>
              <ThemedText>{pwSaving ? '…' : 'Change password'}</ThemedText>
            </Pressable>
          </ThemedView>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
            <ThemedText style={styles.signOutText}>Sign out</ThemedText>
          </Pressable>
        </ScrollView>

        <Modal
          visible={tzModal}
          animationType="slide"
          onRequestClose={() => {
            setTzModal(false);
            setTzQuery('');
          }}>
          <ThemedView style={styles.container}>
            <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
              <View style={styles.modalHeader}>
                <ThemedText type="title">Timezone</ThemedText>
                <Pressable
                  onPress={() => {
                    setTzModal(false);
                    setTzQuery('');
                  }}>
                  <ThemedText themeColor="textSecondary">Close</ThemedText>
                </Pressable>
              </View>
              <TextInput
                value={tzQuery}
                onChangeText={setTzQuery}
                placeholder="Search…"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, styles.modalSearch, { color: theme.text, borderColor: theme.textSecondary }]}
              />
              <FlatList
                data={filteredZones}
                keyExtractor={(z) => z}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const selected = item === tz;
                  return (
                    <Pressable style={styles.tzItem} onPress={() => saveTimezone(item)}>
                      <ThemedText style={selected ? styles.tzItemSelected : undefined}>{item}</ThemedText>
                      {selected && <ThemedText themeColor="textSecondary">✓</ThemedText>}
                    </Pressable>
                  );
                }}
              />
            </SafeAreaView>
          </ThemedView>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: Spacing.four, gap: Spacing.three },
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  outlineBtn: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  error: { color: '#d2433f' },
  signOutBtn: {
    marginTop: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#d2433f',
    alignItems: 'center',
  },
  signOutText: { color: '#d2433f', fontWeight: '600' },
  segmented: { flexDirection: 'row', gap: Spacing.two },
  segment: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
  },
  tzRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  modalSearch: { marginHorizontal: Spacing.four, marginBottom: Spacing.two },
  tzItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  tzItemSelected: { fontWeight: '700' },
});
