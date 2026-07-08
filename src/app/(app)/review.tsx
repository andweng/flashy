import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Confetti } from '@/components/confetti';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import { applyReview, bucketLetter, checkTypedAnswer } from '@/lib/leitner';
import {
  clearReviewSession,
  loadReviewSession,
  saveReviewSession,
} from '@/lib/review-session';
import { getEffectiveToday } from '@/lib/today';
import type { Card, CardState, Deck } from '@/types/domain';

type QueueItem = {
  state: CardState;
  card: Card;
  deck: Deck;
};

type TypedResult = 'correct' | 'wrong' | null;

// Play cards bucket by bucket (A→B→C…), shuffling only within each bucket so the
// order varies day to day without ever mixing buckets together.
function orderWithinBuckets(items: QueueItem[]): QueueItem[] {
  const byBucket = new Map<number, QueueItem[]>();
  for (const it of items) {
    const group = byBucket.get(it.state.bucket_index);
    if (group) group.push(it);
    else byBucket.set(it.state.bucket_index, [it]);
  }
  const out: QueueItem[] = [];
  for (const bucket of [...byBucket.keys()].sort((a, b) => a - b)) {
    const group = byBucket.get(bucket)!;
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    out.push(...group);
  }
  return out;
}

export default function ReviewScreen() {
  const { child } = useCurrentChild();
  const router = useRouter();

  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  const [typedResult, setTypedResult] = useState<TypedResult>(null);
  const [passes, setPasses] = useState(0);
  const [fails, setFails] = useState(0);
  const [today, setToday] = useState('');

  useEffect(() => {
    if (!child) return;
    const childId = child.id;
    let cancelled = false;
    void (async () => {
      const parent = await db.getCurrentParent();
      const tz = parent?.timezone ?? 'UTC';
      const _today = getEffectiveToday(tz);

      // Resume an in-progress session for this child+day (survives a refresh)
      // before falling back to building a fresh queue from what's due.
      const saved = await loadReviewSession(childId, _today);
      if (cancelled) return;
      if (saved) {
        setToday(_today);
        setItems(saved.items);
        setIndex(saved.index);
        setPasses(saved.passes);
        setFails(saved.fails);
        return;
      }

      const due = await db.listDueCardStatesForChild(childId, _today);
      if (cancelled) return;
      // One item per due card — no backlog stacking. Strip the joined card/deck so
      // `state` is a pure CardState; otherwise those objects ride along through
      // applyReview's spread into the card_states upsert as non-existent columns,
      // which Supabase rejects — silently aborting recordAndAdvance.
      const queue: QueueItem[] = due.map((s) => {
        const { card, deck, ...state } = s;
        return { state, card, deck };
      });
      const ordered = orderWithinBuckets(queue);
      setToday(_today);
      setItems(ordered);
      setIndex(0);
      setPasses(0);
      setFails(0);
      // Snapshot the fresh queue so a refresh mid-session resumes this exact
      // order/position; nothing due means nothing to resume.
      if (ordered.length > 0) {
        saveReviewSession(childId, {
          version: 1,
          today: _today,
          items: ordered,
          index: 0,
          passes: 0,
          fails: 0,
        });
      } else {
        clearReviewSession(childId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [child]);

  if (!child || !items) {
    return <CenteredMessage text="Loading…" />;
  }

  const current = items[index];

  if (!current) {
    return (
      <CompletionScreen
        passes={passes}
        fails={fails}
        onDone={() => router.replace('/home')}
      />
    );
  }

  async function recordAndAdvance(
    outcome: 'pass' | 'fail',
    input: string | null,
  ) {
    if (!child || !items) return;
    const item = items[index];
    const update = applyReview(item.state, item.deck, child, today, { kind: outcome });

    await db.upsertCardState(update.next_state);
    await db.recordReview({
      child_id: child.id,
      card_id: item.card.id,
      outcome,
      bucket_before: item.state.bucket_index,
      bucket_after: update.next_state.bucket_index,
      user_input: input,
    });

    const nextPasses = outcome === 'pass' ? passes + 1 : passes;
    const nextFails = outcome === 'fail' ? fails + 1 : fails;
    const nextIndex = index + 1;
    setPasses(nextPasses);
    setFails(nextFails);
    setIndex(nextIndex);
    setRevealed(false);
    setTypedInput('');
    setTypedResult(null);

    // Persist the new position/tally so a refresh resumes here. Reaching the end
    // finishes the session, so drop it rather than resurrecting the done screen.
    if (nextIndex >= items.length) {
      clearReviewSession(child.id);
    } else {
      saveReviewSession(child.id, {
        version: 1,
        today,
        items,
        index: nextIndex,
        passes: nextPasses,
        fails: nextFails,
      });
    }
  }

  // Defer the current card: rotate it to the end of the queue and show the next.
  function moveToBack() {
    if (!child || !items || items.length - index <= 1) return;
    const cur = items[index];
    const reordered = [...items.slice(0, index), ...items.slice(index + 1), cur];
    setItems(reordered);
    setRevealed(false);
    setTypedInput('');
    setTypedResult(null);
    // Persist the new order so a refresh resumes with the same next card.
    saveReviewSession(child.id, {
      version: 1,
      today,
      items: reordered,
      index,
      passes,
      fails,
    });
  }

  function checkTyped() {
    const correct = checkTypedAnswer(current.card, typedInput);
    setTypedResult(correct ? 'correct' : 'wrong');
    setRevealed(true);
  }

  // Until dedicated multiple-choice UI exists, non-typed modes (self_grade and
  // multiple_choice) share the reveal + self-grade flow. This keeps imported MC
  // cards playable instead of soft-locking the session.
  const noBack = current.card.grading_mode !== 'typed' && current.card.back.trim() === '';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ProgressBar current={index + 1} total={items.length} />

        <ThemedText themeColor="textSecondary" type="small" style={styles.meta}>
          {current.deck.name} · Bucket {bucketLetter(current.state.bucket_index)}
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.cardArea}>
          <ThemedText type="title" style={styles.front}>
            {current.card.front}
          </ThemedText>

          {current.card.grading_mode !== 'typed' && revealed && current.card.back && (
            <ThemedText type="subtitle" style={styles.back}>
              {current.card.back}
            </ThemedText>
          )}

          {current.card.grading_mode === 'typed' && (
            <TypedAnswerArea
              input={typedInput}
              setInput={setTypedInput}
              locked={revealed}
              result={typedResult}
              correctAnswer={current.card.back}
              onSubmit={checkTyped}
            />
          )}
        </ThemedView>

        <View style={styles.actions}>
          {current.card.grading_mode !== 'typed' && !revealed && !noBack && (
            <PrimaryButton label="Show answer" onPress={() => setRevealed(true)} />
          )}
          {current.card.grading_mode !== 'typed' && (revealed || noBack) && (
            <View style={styles.dualButtons}>
              <ResultButton label="Missed" tone="fail" onPress={() => recordAndAdvance('fail', null)} />
              <ResultButton label="Got it" tone="pass" onPress={() => recordAndAdvance('pass', null)} />
            </View>
          )}
          {current.card.grading_mode === 'typed' && !revealed && (
            <PrimaryButton label="Check" onPress={checkTyped} />
          )}
          {current.card.grading_mode === 'typed' && revealed && typedResult === 'correct' && (
            <ResultButton label="Continue" tone="pass" onPress={() => recordAndAdvance('pass', typedInput)} />
          )}
          {current.card.grading_mode === 'typed' && revealed && typedResult === 'wrong' && (
            <View style={styles.dualButtons}>
              <ResultButton label="Missed" tone="fail" onPress={() => recordAndAdvance('fail', typedInput)} />
              <ResultButton label="I had it" tone="pass" onPress={() => recordAndAdvance('pass', typedInput)} />
            </View>
          )}
          {items.length - index > 1 && (
            <Pressable style={styles.skipBtn} onPress={moveToBack}>
              <ThemedText themeColor="textSecondary" type="small">
                Move to back ↪
              </ThemedText>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.min(100, (current / total) * 100);
  return (
    <View style={progressStyles.wrap}>
      <ThemedText themeColor="textSecondary" type="small">
        {current} / {total}
      </ThemedText>
      <View style={progressStyles.bar}>
        <View style={[progressStyles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safe, styles.centered]}>
        <ThemedText themeColor="textSecondary">{text}</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

function CompletionScreen({
  passes,
  fails,
  onDone,
}: {
  passes: number;
  fails: number;
  onDone: () => void;
}) {
  const total = passes + fails;
  // Each launch is its own Confetti instance so taps stack additively instead of
  // replacing the previous burst. The "Done!" screen auto-fires one on mount;
  // "All done!" fires only when its emoji is tapped. Each instance removes itself
  // once finished (onDone) so the list doesn't grow without bound.
  const [bursts, setBursts] = useState<number[]>(() => (total > 0 ? [0] : []));
  const nextBurstId = useRef(1);

  function launchConfetti() {
    const id = nextBurstId.current;
    nextBurstId.current += 1;
    setBursts((b) => [...b, id]);
  }
  function removeBurst(id: number) {
    setBursts((b) => b.filter((x) => x !== id));
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safe, styles.centered]}>
        {total === 0 ? (
          <>
            <ThemedText type="title">
              All done!{' '}
              <ThemedText type="title" onPress={launchConfetti}>
                🎉
              </ThemedText>
            </ThemedText>
            <ThemedText themeColor="textSecondary">Nothing was due. Come back tomorrow.</ThemedText>
          </>
        ) : (
          <>
            <ThemedText type="title">
              Done!{' '}
              <ThemedText type="title" onPress={launchConfetti}>
                🎉
              </ThemedText>
            </ThemedText>
            <ThemedText type="subtitle">
              {passes} passed · {fails} missed
            </ThemedText>
          </>
        )}
        <PrimaryButton label="Back home" onPress={onDone} style={styles.completionButton} />
      </SafeAreaView>
      {bursts.map((id) => (
        <Confetti key={id} onDone={() => removeBurst(id)} />
      ))}
    </ThemedView>
  );
}

function TypedAnswerArea({
  input,
  setInput,
  locked,
  result,
  correctAnswer,
  onSubmit,
}: {
  input: string;
  setInput: (s: string) => void;
  locked: boolean;
  result: TypedResult;
  correctAnswer: string;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={typedStyles.wrap}>
      <TextInput
        value={input}
        onChangeText={setInput}
        editable={!locked}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        onSubmitEditing={onSubmit}
        style={[typedStyles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        placeholderTextColor={theme.textSecondary}
        returnKeyType="done"
      />
      {locked && (
        <View style={typedStyles.feedback}>
          <ThemedText type="subtitle">
            {result === 'correct' ? '✓ ' : '✗ '}
            {correctAnswer}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable style={[styles.button, styles.primary, style]} onPress={onPress}>
      <ThemedText style={styles.buttonText}>{label}</ThemedText>
    </Pressable>
  );
}

function ResultButton({
  label,
  tone,
  onPress,
}: {
  label: string;
  tone: 'pass' | 'fail';
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.button, tone === 'pass' ? styles.pass : styles.fail]}
      onPress={onPress}>
      <ThemedText style={styles.buttonText}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four, gap: Spacing.three },
  centered: { alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  meta: { textAlign: 'center' },
  cardArea: {
    flex: 1,
    padding: Spacing.five,
    borderRadius: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  front: { textAlign: 'center' },
  back: { textAlign: 'center' },
  actions: { gap: Spacing.three },
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.two },
  dualButtons: { flexDirection: 'row', gap: Spacing.three },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#888',
  },
  primary: { backgroundColor: '#3c87f7', borderColor: '#3c87f7' },
  pass: { backgroundColor: '#2eab63', borderColor: '#2eab63' },
  fail: { backgroundColor: '#d2433f', borderColor: '#d2433f' },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  completionButton: { flex: 0, minHeight: 56 },
});

const progressStyles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  bar: { height: 4, backgroundColor: '#888', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#3c87f7' },
});

const typedStyles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.three, width: '100%' },
  input: {
    fontSize: 28,
    textAlign: 'center',
    minWidth: 220,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: 2,
  },
  feedback: { alignItems: 'center' },
});
