import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AVATARS } from '@/lib/avatars';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import {
  applyReview,
  bucketLetter,
  bucketsTestedOnDay,
  DEFAULT_BUCKET_INTERVALS,
} from '@/lib/leitner';
import { getDayOffset, getEffectiveToday, setDayOffset } from '@/lib/today';
import type { CardState } from '@/types/domain';

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

  // Day offset (used for migrating a child mid-cycle / previewing the schedule)
  const [dayInput, setDayInput] = useState<string>(String(getDayOffset()));
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayFeedback, setDayFeedback] = useState<string | null>(null);
  const [effectiveToday, setEffectiveToday] = useState<string>(getEffectiveToday());
  const [appliedDay, setAppliedDay] = useState<number>(getDayOffset());

  useEffect(() => {
    if (!child) return;
    // Sync the editable form fields when the selected child loads/changes.
    // These are user-editable afterwards, so a key-reset wouldn't fit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(child.display_name);
    setAvatar(child.avatar ?? AVATARS[0]);
    setGraduateEnabled(child.graduate_after_passes != null);
    setGraduateN(child.graduate_after_passes != null ? String(child.graduate_after_passes) : '3');
  }, [child]);

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

  async function applyDayOffset() {
    setDayError(null);
    setDayFeedback(null);
    const parsed = parseInt(dayInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDayError('Day must be a non-negative integer.');
      return;
    }
    try {
      await setDayOffset(parsed);
      setAppliedDay(parsed);
      setEffectiveToday(getEffectiveToday());
      setDayFeedback(parsed === 0 ? 'Reset to real today.' : `Now treating today as day ${parsed}.`);
      setTimeout(() => setDayFeedback(null), 2000);
    } catch (e) {
      setDayError(e instanceof Error ? e.message : 'Could not save.');
    }
  }

  async function resetDayOffset() {
    setDayInput('0');
    await setDayOffset(0);
    setAppliedDay(0);
    setEffectiveToday(getEffectiveToday());
    setDayFeedback('Reset to real today.');
    setTimeout(() => setDayFeedback(null), 2000);
  }

  // Preview: which buckets would be tested on the entered day, using default Leitner doubling.
  const previewDay = (() => {
    const n = parseInt(dayInput.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();
  const previewBuckets = bucketsTestedOnDay(previewDay, DEFAULT_BUCKET_INTERVALS);

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

          {/* Schedule — set what day of the Leitner cycle we're on */}
          <ThemedText type="smallBold">Schedule</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText themeColor="textSecondary" type="small">
              What day of the cycle is the child on? 0 = today is day 0 (fresh start). Bumping this
              shifts the effective &quot;today&quot; forward by that many days, so next-due math lines up
              with where the child already is when migrating in from another app.
            </ThemedText>
            <View style={styles.dayInputRow}>
              <ThemedText>Day</ThemedText>
              <TextInput
                value={dayInput}
                onChangeText={setDayInput}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[styles.numInput, { color: theme.text, borderColor: theme.textSecondary }]}
              />
            </View>
            <ThemedText themeColor="textSecondary" type="small">
              {previewDay === 0
                ? 'On day 0, nothing is tested yet.'
                : previewBuckets.length === 0
                  ? `On day ${previewDay}, no buckets would be tested in a fresh-start schedule.`
                  : `On day ${previewDay}, buckets ${previewBuckets.map(bucketLetter).join(', ')} would be tested${' '}(default Leitner schedule).`}
            </ThemedText>
            <View style={styles.todayBtnRow}>
              <Pressable style={styles.outlineBtn} onPress={resetDayOffset}>
                <ThemedText>Reset</ThemedText>
              </Pressable>
              <Pressable style={styles.todaySaveBtn} onPress={applyDayOffset}>
                <ThemedText style={styles.saveBtnText}>Apply</ThemedText>
              </Pressable>
            </View>
            <ThemedText themeColor="textSecondary" type="small">
              Applied: day {appliedDay} · Effective today: {effectiveToday}
            </ThemedText>
            {dayError && <ThemedText style={styles.error}>{dayError}</ThemedText>}
            {dayFeedback && (
              <ThemedText themeColor="textSecondary" type="small">{dayFeedback}</ThemedText>
            )}
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
  dayInputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  todayBtnRow: { flexDirection: 'row', gap: Spacing.two },
  todaySaveBtn: {
    flex: 1,
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
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
});
