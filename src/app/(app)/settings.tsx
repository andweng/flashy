import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { AVATARS } from '@/lib/avatars';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import { applyReview } from '@/lib/leitner';
import { useThemePreference, type ThemePreference } from '@/lib/theme-preference';
import { getEffectiveToday } from '@/lib/today';
import { deviceTimezone, listTimezones } from '@/lib/timezones';
import type { CardState } from '@/types/domain';

// Light/Dark only for now. The stored default stays 'system' (follows the OS)
// until the parent taps one; the highlighted segment reflects the resolved
// scheme, so something is always selected.
const THEME_OPTIONS: { value: Exclude<ThemePreference, 'system'>; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { child, setChild } = useCurrentChild();

  const [name, setName] = useState(child?.display_name ?? '');
  const [avatar, setAvatar] = useState<string>(child?.avatar ?? AVATARS[0]);
  const [graduateEnabled, setGraduateEnabled] = useState<boolean>(
    child?.graduate_after_passes != null,
  );
  const [graduateN, setGraduateN] = useState<string>(
    child?.graduate_after_passes != null ? String(child.graduate_after_passes) : '3',
  );

  const [savePending, setSavePending] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [resetting, setResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  const [markingDone, setMarkingDone] = useState(false);
  const [confirmingDone, setConfirmingDone] = useState(false);
  const [doneFeedback, setDoneFeedback] = useState<string | null>(null);

  const [tz, setTz] = useState('UTC');
  const [tzModal, setTzModal] = useState(false);
  const [tzQuery, setTzQuery] = useState('');
  const [tzSaving, setTzSaving] = useState(false);
  const [tzFeedback, setTzFeedback] = useState<string | null>(null);

  const { preference: themePref, setPreference: setThemePref, colorScheme } = useThemePreference();
  const { changePassword } = useAuth();

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

  useEffect(() => {
    if (!child) return;
    // Sync the editable form fields when the selected child loads/changes.
    // These are user-editable afterwards, so a key-reset wouldn't fit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(child.display_name);
    setAvatar(child.avatar ?? AVATARS[0]);
    setGraduateEnabled(child.graduate_after_passes != null);
    setGraduateN(child.graduate_after_passes != null ? String(child.graduate_after_passes) : '3');
  }, [child, tz]);

  if (!child) return null;

  const dirty =
    name.trim() !== child.display_name ||
    avatar !== (child.avatar ?? AVATARS[0]) ||
    (graduateEnabled
      ? parseInt(graduateN, 10) !== child.graduate_after_passes
      : child.graduate_after_passes !== null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty.');
      return;
    }
    const n = graduateEnabled ? Math.max(1, parseInt(graduateN, 10) || 1) : null;
    setSavePending(true);
    setError(null);
    setSaveFeedback(null);
    try {
      const updated = await db.updateChild(child!.id, {
        display_name: trimmed,
        avatar,
        graduate_after_passes: n,
      });
      setChild(updated);
      setSaveFeedback('Saved.');
      setTimeout(() => setSaveFeedback(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavePending(false);
    }
  }

  async function saveTimezone(next: string) {
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
      setTz(tz);
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

  async function handleReset() {
    if (!child) return;
    if (!confirmingReset) {
      setConfirmingReset(true);
      setConfirmingDone(false);
      return;
    }
    setResetting(true);
    setError(null);
    setResetFeedback(null);
    try {
      const parent = await db.getCurrentParent();
      const tz = parent?.timezone ?? 'UTC';
      const today = getEffectiveToday(tz);
      const n = await db.resetTodaysReviewsForChild(child.id, today, tz);
      setResetFeedback(
        n === 0
          ? 'No reviews from today to reset.'
          : `Reset ${n} card${n === 1 ? '' : 's'} to the start of today.`,
      );
      setTimeout(() => setResetFeedback(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset today.');
    } finally {
      setResetting(false);
      setConfirmingReset(false);
    }
  }

  async function handleMarkAllDone() {
    if (!child) return;
    if (!confirmingDone) {
      setConfirmingDone(true);
      setConfirmingReset(false);
      return;
    }
    setMarkingDone(true);
    setError(null);
    setDoneFeedback(null);
    try {
      const parent = await db.getCurrentParent();
      const tz = parent?.timezone ?? 'UTC';
      const today = getEffectiveToday(tz);
      const due = await db.listDueCardStatesForChild(child.id, today);
      for (const item of due) {
        // listDue returns CardState joined with card/deck; pare it back to a
        // plain CardState so only real columns reach upsertCardState.
        const state: CardState = {
          child_id: item.child_id,
          card_id: item.card_id,
          bucket_index: item.bucket_index,
          next_due_on: item.next_due_on,
          consecutive_passes_in_top_bucket: item.consecutive_passes_in_top_bucket,
          graduated_at: item.graduated_at,
          last_reviewed_at: item.last_reviewed_at,
        };
        // Treat each due card as one passed review: promote its bucket and push
        // its due date past today. Recording the review lets "Reset today's
        // cards" undo this just like a normal review session.
        const update = applyReview(state, item.deck, child, today, { kind: 'pass' }, true);
        await db.upsertCardState(update.next_state);
        await db.recordReview({
          child_id: child.id,
          card_id: state.card_id,
          outcome: 'pass',
          bucket_before: state.bucket_index,
          bucket_after: update.next_state.bucket_index,
          user_input: null,
        });
      }
      setDoneFeedback(
        due.length === 0
          ? 'No cards due today.'
          : `Marked ${due.length} card${due.length === 1 ? '' : 's'} done for today.`,
      );
      setTimeout(() => setDoneFeedback(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark cards done.');
    } finally {
      setMarkingDone(false);
      setConfirmingDone(false);
    }
  }

  async function handleDelete() {
    if (!child) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    try {
      await db.deleteChild(child.id);
      setChild(null);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete profile.');
      setConfirmingDelete(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">Settings</ThemedText>

          {/* Profile */}
          <ThemedText type="smallBold">Profile</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText themeColor="textSecondary" type="small">Name</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={theme.textSecondary}
              editable={!savePending}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            <ThemedText themeColor="textSecondary" type="small">Avatar</ThemedText>
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
          </ThemedView>

          {/* Graduation rule */}
          <ThemedText type="smallBold">Mastery</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <ThemedText>Graduate cards out of the top bucket</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">
                  When off, top-bucket cards keep cycling forever.
                </ThemedText>
              </View>
              <Switch value={graduateEnabled} onValueChange={setGraduateEnabled} />
            </View>
            {graduateEnabled && (
              <View style={styles.graduateRow}>
                <ThemedText>After</ThemedText>
                <TextInput
                  value={graduateN}
                  onChangeText={setGraduateN}
                  keyboardType="number-pad"
                  editable={!savePending}
                  style={[styles.numInput, { color: theme.text, borderColor: theme.textSecondary }]}
                />
                <ThemedText>consecutive top-bucket passes</ThemedText>
              </View>
            )}
          </ThemedView>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {saveFeedback && (
            <ThemedText themeColor="textSecondary" type="small">{saveFeedback}</ThemedText>
          )}

          <Pressable
            style={[styles.saveBtn, (!dirty || savePending) && styles.saveBtnDisabled]}
            onPress={save}
            disabled={!dirty || savePending}>
            <ThemedText style={styles.saveBtnText}>{savePending ? '…' : 'Save changes'}</ThemedText>
          </Pressable>

          {/* Appearance */}
          <ThemedText type="smallBold">Appearance</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText themeColor="textSecondary" type="small">
              {themePref === 'system'
                ? 'Following your device. Pick one to override.'
                : 'Theme'}
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

          {/* Timezone (parent-wide) */}
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

          {/* Change password */}
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
              style={[styles.outlineBtn, (pwSaving || !newPassword) && styles.saveBtnDisabled]}
              onPress={handleChangePassword}
              disabled={pwSaving || !newPassword}>
              <ThemedText>{pwSaving ? '…' : 'Change password'}</ThemedText>
            </Pressable>
          </ThemedView>

          {/* Today's review */}
          <ThemedText type="smallBold">Today&apos;s review</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText themeColor="textSecondary" type="small">
              Reset undoes all of {child.display_name}&apos;s reviews from today — cards go back to
              the bucket and due date they had this morning. Mark all done passes every card due
              today, advancing each as if reviewed. Both can be undone with Reset.
            </ThemedText>
            {resetFeedback && (
              <ThemedText themeColor="textSecondary" type="small">{resetFeedback}</ThemedText>
            )}
            {doneFeedback && (
              <ThemedText themeColor="textSecondary" type="small">{doneFeedback}</ThemedText>
            )}
            <View style={styles.btnRow}>
              <Pressable
                style={[styles.outlineBtn, styles.btnRowItem]}
                onPress={handleReset}
                disabled={resetting || markingDone}
              >
                <ThemedText>
                  {resetting
                    ? '…'
                    : confirmingReset
                      ? "Tap again to reset"
                      : "Reset today's cards"}
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.outlineBtn, styles.btnRowItem]}
                onPress={handleMarkAllDone}
                disabled={markingDone || resetting}
              >
                <ThemedText>
                  {markingDone
                    ? '…'
                    : confirmingDone
                      ? 'Tap again to mark done'
                      : 'Mark all done'}
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>

          {/* Danger */}
          <ThemedText type="smallBold" style={styles.dangerLabel}>Danger zone</ThemedText>
          <Pressable style={styles.deleteBtn} onPress={handleDelete}>
            <ThemedText style={styles.deleteBtnText}>
              {confirmingDelete
                ? `Tap again to delete ${child.display_name}`
                : `Delete ${child.display_name}`}
            </ThemedText>
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
  numInput: {
    fontSize: 16,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.two,
    minWidth: 48,
    textAlign: 'center',
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  switchText: { flex: 1, gap: Spacing.half },
  graduateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  saveBtn: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#ffffff', fontWeight: '600' },
  outlineBtn: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  btnRow: { flexDirection: 'row', gap: Spacing.two },
  btnRowItem: { flex: 1 },
  dangerLabel: { marginTop: Spacing.three },
  deleteBtn: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#d2433f',
    alignItems: 'center',
  },
  deleteBtnText: { color: '#d2433f', fontWeight: '600' },
  error: { color: '#d2433f' },
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
