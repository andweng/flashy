import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentChild } from '@/lib/current-child';
import { db } from '@/lib/db';
import { serializeDeck } from '@/lib/deck-export';
import { bucketLetter, cycleDayOf, dueDateForCycleDay } from '@/lib/leitner';
import { getEffectiveToday } from '@/lib/today';
import type { Card, CardState, Child, Deck, GradingMode } from '@/types/domain';

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const { child: currentChild } = useCurrentChild();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [assignedSet, setAssignedSet] = useState<Set<string>>(new Set());
  const [cardStates, setCardStates] = useState<Map<string, CardState>>(new Map());
  const [bucketPickerCardId, setBucketPickerCardId] = useState<string | null>(null);

  // Quick-add form
  const frontRef = useRef<TextInput>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [mode, setMode] = useState<GradingMode>('self_grade');
  // Sticky across adds — picking E once lets you batch-add E cards
  const [addBucket, setAddBucket] = useState(0);
  const [addPending, setAddPending] = useState(false);

  // Inline deck editing (name + description)
  const [editingDeck, setEditingDeck] = useState(false);
  const [editDeckName, setEditDeckName] = useState('');
  const [editDeckDescription, setEditDeckDescription] = useState('');
  const [editDeckPending, setEditDeckPending] = useState(false);

  // Inline card editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [editMode, setEditMode] = useState<GradingMode>('self_grade');
  const [editPending, setEditPending] = useState(false);

  // Sharing
  const [duplicating, setDuplicating] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Delete-deck confirmation
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [d, cs, parent, assignedIds] = await Promise.all([
      db.getDeck(id),
      db.listCardsInDeck(id),
      db.getCurrentParent(),
      db.listDeckAssignments(id),
    ]);
    setDeck(d);
    setCards(cs);
    setAssignedSet(new Set(assignedIds));
    if (parent) setChildren(await db.listChildren(parent.id));
    if (currentChild) {
      const all = await db.listCardStatesForChild(currentChild.id);
      setCardStates(new Map(all.map((s) => [s.card_id, s])));
    } else {
      setCardStates(new Map());
    }
  }, [id, currentChild]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function addCard() {
    if (!deck) return;
    const f = front.trim();
    const b = back.trim();
    if (!f) return;
    if (mode === 'typed' && !b) return;
    setAddPending(true);
    try {
      const created = await db.createCard({
        deck_id: deck.id,
        front: f,
        back: b,
        grading_mode: mode,
        typed_alternates: [],
        choices: [],
      });
      // Per-child bucket state only applies when a child is selected
      if (currentChild) {
        const realToday = getEffectiveToday('UTC');
        const assignment = await db.getDeckAssignment(deck.id, currentChild.id);
        const cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday);
        await db.upsertCardState({
          child_id: currentChild.id,
          card_id: created.id,
          bucket_index: addBucket,
          next_due_on: dueDateForCycleDay(realToday, cycleDay, addBucket, deck.bucket_intervals_days),
          consecutive_passes_in_top_bucket: 0,
          graduated_at: null,
          last_reviewed_at: null,
        });
      }
      setFront('');
      setBack('');
      await refresh();
    } finally {
      setAddPending(false);
      // Return cursor to Front for smooth back-to-back entry
      requestAnimationFrame(() => frontRef.current?.focus());
    }
  }

  async function removeCard(cardId: string) {
    await db.deleteCard(cardId);
    setCards((cs) => cs.filter((c) => c.id !== cardId));
    if (editingId === cardId) setEditingId(null);
  }

  function startEdit(card: Card) {
    setEditingId(card.id);
    setEditFront(card.front);
    setEditBack(card.back);
    setEditMode(card.grading_mode);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    const f = editFront.trim();
    const b = editBack.trim();
    if (!f) return;
    if (editMode === 'typed' && !b) return;
    setEditPending(true);
    try {
      const updated = await db.updateCard(editingId, {
        front: f,
        back: b,
        grading_mode: editMode,
      });
      setCards((cs) => cs.map((c) => (c.id === editingId ? updated : c)));
      setEditingId(null);
    } finally {
      setEditPending(false);
    }
  }

  function startEditDeck() {
    if (!deck) return;
    setEditDeckName(deck.name);
    setEditDeckDescription(deck.description ?? '');
    setEditingDeck(true);
  }

  function cancelEditDeck() {
    setEditingDeck(false);
  }

  async function saveEditDeck() {
    if (!deck) return;
    const name = editDeckName.trim();
    if (!name) return;
    setEditDeckPending(true);
    try {
      const updated = await db.updateDeck(deck.id, {
        name,
        description: editDeckDescription.trim() || null,
      });
      setDeck(updated);
      setEditingDeck(false);
    } finally {
      setEditDeckPending(false);
    }
  }

  async function setBucket(cardId: string, bucketIndex: number) {
    if (!currentChild || !deck) return;
    const existing = cardStates.get(cardId);
    const realToday = getEffectiveToday('UTC');
    const assignment = await db.getDeckAssignment(deck.id, currentChild.id);
    const cycleDay = cycleDayOf(assignment?.cycle_start_date ?? null, realToday);
    const newState: CardState = {
      child_id: currentChild.id,
      card_id: cardId,
      bucket_index: bucketIndex,
      next_due_on: dueDateForCycleDay(realToday, cycleDay, bucketIndex, deck.bucket_intervals_days),
      consecutive_passes_in_top_bucket: 0,
      graduated_at: null,
      last_reviewed_at: existing?.last_reviewed_at ?? null,
    };
    await db.upsertCardState(newState);
    setCardStates((m) => {
      const next = new Map(m);
      next.set(cardId, newState);
      return next;
    });
    setBucketPickerCardId(null);
  }

  async function toggleAssign(childId: string, currentlyAssigned: boolean) {
    if (!deck) return;
    if (currentlyAssigned) await db.unassignDeckFromChild(deck.id, childId);
    else await db.assignDeckToChild(deck.id, childId);
    setAssignedSet((s) => {
      const next = new Set(s);
      if (currentlyAssigned) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  async function duplicateDeck() {
    if (!deck) return;
    const parent = await db.getCurrentParent();
    if (!parent) return;
    setDuplicating(true);
    try {
      const newDeck = await db.createDeck({
        parent_id: parent.id,
        name: `${deck.name} (copy)`,
        description: deck.description,
        bucket_intervals_days: deck.bucket_intervals_days,
      });
      for (const card of cards) {
        await db.createCard({
          deck_id: newDeck.id,
          front: card.front,
          back: card.back,
          grading_mode: card.grading_mode,
          typed_alternates: card.typed_alternates,
          choices: card.choices,
        });
      }
      router.push(`/decks/${newDeck.id}`);
    } finally {
      setDuplicating(false);
    }
  }

  async function copyShareCode() {
    if (!deck) return;
    try {
      await Clipboard.setStringAsync(serializeDeck(deck, cards));
      setCopyFeedback('Copied! Paste it into another Flashy account → Decks → Import.');
    } catch {
      setCopyFeedback('Copy failed — try long-pressing the code below.');
    }
    setTimeout(() => setCopyFeedback(null), 4000);
  }

  async function handleDelete() {
    if (!deck) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    await db.deleteDeck(deck.id);
    router.replace('/decks');
  }

  if (!deck) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Deck' }} />
        <SafeAreaView style={[styles.safe, styles.centered]}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Per-child count of cards in each bucket, e.g. "3 A, 1 B". Only meaningful
  // when a child is selected (bucket state is per-child).
  const bucketBreakdown =
    currentChild && cardStates.size > 0
      ? deck.bucket_intervals_days
          .map((_, i) => ({
            i,
            n: cards.filter((c) => cardStates.get(c.id)?.bucket_index === i).length,
          }))
          .filter(({ n }) => n > 0)
          .map(({ i, n }) => `${n} ${bucketLetter(i)}`)
          .join(', ')
      : '';

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: deck.name }} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {editingDeck ? (
            <ThemedView type="backgroundElement" style={styles.section}>
              <TextInput
                value={editDeckName}
                onChangeText={setEditDeckName}
                placeholder="Deck name"
                placeholderTextColor={theme.textSecondary}
                editable={!editDeckPending}
                autoFocus
                style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
              />
              <TextInput
                value={editDeckDescription}
                onChangeText={setEditDeckDescription}
                placeholder="Description (optional)"
                placeholderTextColor={theme.textSecondary}
                editable={!editDeckPending}
                multiline
                style={[
                  styles.input,
                  styles.deckEditMultiline,
                  { color: theme.text, borderColor: theme.textSecondary },
                ]}
              />
              <View style={styles.editButtons}>
                <Pressable
                  onPress={cancelEditDeck}
                  style={styles.cancelBtn}
                  disabled={editDeckPending}>
                  <ThemedText themeColor="textSecondary">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={saveEditDeck}
                  style={[
                    styles.saveBtn,
                    (!editDeckName.trim() || editDeckPending) && styles.addBtnDisabled,
                  ]}
                  disabled={!editDeckName.trim() || editDeckPending}>
                  <ThemedText style={styles.addBtnText}>
                    {editDeckPending ? '…' : 'Save'}
                  </ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          ) : (
            <>
              <View style={styles.titleRow}>
                <ThemedText type="title" style={styles.flex1}>{deck.name}</ThemedText>
                <Pressable onPress={startEditDeck}>
                  <ThemedText themeColor="textSecondary">Edit</ThemedText>
                </Pressable>
              </View>
              {deck.description && (
                <ThemedText themeColor="textSecondary">{deck.description}</ThemedText>
              )}
              <ThemedText themeColor="textSecondary" type="small">
                Schedule:{' '}
                {deck.bucket_intervals_days
                  .map((d, i) => `${bucketLetter(i)} every ${d}d`)
                  .join(' · ')}
              </ThemedText>
            </>
          )}

          {/* Quick-add card */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">Add card</ThemedText>
            <TextInput
              ref={frontRef}
              value={front}
              onChangeText={setFront}
              placeholder="Front"
              placeholderTextColor={theme.textSecondary}
              editable={!addPending}
              autoFocus
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={addCard}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            <TextInput
              value={back}
              onChangeText={setBack}
              placeholder={mode === 'typed' ? 'Back (the answer)' : 'Back (optional)'}
              placeholderTextColor={theme.textSecondary}
              editable={!addPending}
              blurOnSubmit={false}
              onSubmitEditing={addCard}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            <View style={styles.modeRow}>
              <Pressable
                onPress={() => setMode('self_grade')}
                style={[styles.modeChip, mode === 'self_grade' && styles.modeChipActive]}>
                <ThemedText type="small">Self-grade</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setMode('typed')}
                style={[styles.modeChip, mode === 'typed' && styles.modeChipActive]}>
                <ThemedText type="small">Typed</ThemedText>
              </Pressable>
            </View>
            {currentChild && deck && (
              <View style={styles.addBucketGroup}>
                <ThemedText type="small">Start bucket</ThemedText>
                <View style={styles.bucketPickerRow}>
                  {deck.bucket_intervals_days.map((_, i) => (
                    <Pressable
                      key={i}
                      onPress={() => setAddBucket(i)}
                      disabled={addPending}
                      style={[styles.bucketBtn, addBucket === i && styles.bucketBtnActive]}>
                      <ThemedText>{bucketLetter(i)}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            <Pressable
              style={[
                styles.addBtn,
                (!front.trim() || (mode === 'typed' && !back.trim()) || addPending) &&
                  styles.addBtnDisabled,
              ]}
              onPress={addCard}
              disabled={!front.trim() || (mode === 'typed' && !back.trim()) || addPending}>
              <ThemedText style={styles.addBtnText}>{addPending ? '…' : 'Add card'}</ThemedText>
            </Pressable>
          </ThemedView>

          {/* Card list */}
          <ThemedText type="smallBold">
            {cards.length} card{cards.length === 1 ? '' : 's'}
            {bucketBreakdown && ` (${bucketBreakdown})`}
          </ThemedText>
          {cards.map((card) =>
            editingId === card.id ? (
              <ThemedView key={card.id} type="backgroundElement" style={styles.section}>
                <TextInput
                  value={editFront}
                  onChangeText={setEditFront}
                  placeholder="Front"
                  placeholderTextColor={theme.textSecondary}
                  editable={!editPending}
                  autoFocus
                  style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
                />
                <TextInput
                  value={editBack}
                  onChangeText={setEditBack}
                  placeholder={editMode === 'typed' ? 'Back (the answer)' : 'Back (optional)'}
                  placeholderTextColor={theme.textSecondary}
                  editable={!editPending}
                  onSubmitEditing={saveEdit}
                  style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
                />
                <View style={styles.modeRow}>
                  <Pressable
                    onPress={() => setEditMode('self_grade')}
                    style={[styles.modeChip, editMode === 'self_grade' && styles.modeChipActive]}>
                    <ThemedText type="small">Self-grade</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setEditMode('typed')}
                    style={[styles.modeChip, editMode === 'typed' && styles.modeChipActive]}>
                    <ThemedText type="small">Typed</ThemedText>
                  </Pressable>
                </View>
                <View style={styles.editButtons}>
                  <Pressable onPress={cancelEdit} style={styles.cancelBtn} disabled={editPending}>
                    <ThemedText themeColor="textSecondary">Cancel</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={saveEdit}
                    style={[
                      styles.saveBtn,
                      (!editFront.trim() ||
                        (editMode === 'typed' && !editBack.trim()) ||
                        editPending) &&
                        styles.addBtnDisabled,
                    ]}
                    disabled={
                      !editFront.trim() || (editMode === 'typed' && !editBack.trim()) || editPending
                    }>
                    <ThemedText style={styles.addBtnText}>{editPending ? '…' : 'Save'}</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ) : (
              <ThemedView key={card.id} type="backgroundElement" style={styles.cardRow}>
                <View style={styles.cardRowMain}>
                  <Pressable style={styles.cardText} onPress={() => startEdit(card)}>
                    <ThemedText>{card.front}</ThemedText>
                    {card.back && (
                      <ThemedText themeColor="textSecondary" type="small">{card.back}</ThemedText>
                    )}
                    <ThemedText themeColor="textSecondary" type="small">
                      {card.grading_mode === 'typed' ? 'typed' : 'self-grade'}
                    </ThemedText>
                  </Pressable>
                  <View style={styles.rowActions}>
                    {currentChild && cardStates.has(card.id) && (
                      <Pressable
                        onPress={() =>
                          setBucketPickerCardId(bucketPickerCardId === card.id ? null : card.id)
                        }
                        style={styles.bucketChip}>
                        <ThemedText type="small">
                          Bucket {bucketLetter(cardStates.get(card.id)!.bucket_index)}
                        </ThemedText>
                      </Pressable>
                    )}
                    <Pressable onPress={() => startEdit(card)}>
                      <ThemedText themeColor="textSecondary">Edit</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => removeCard(card.id)}>
                      <ThemedText style={styles.deleteText}>Delete</ThemedText>
                    </Pressable>
                  </View>
                </View>
                {bucketPickerCardId === card.id && deck && (
                  <View style={styles.bucketPickerRow}>
                    {deck.bucket_intervals_days.map((_, i) => {
                      const active = cardStates.get(card.id)?.bucket_index === i;
                      return (
                        <Pressable
                          key={i}
                          onPress={() => setBucket(card.id, i)}
                          style={[styles.bucketBtn, active && styles.bucketBtnActive]}>
                          <ThemedText>{bucketLetter(i)}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </ThemedView>
            ),
          )}

          {/* Assignments */}
          {children.length > 0 && (
            <>
              <ThemedText type="smallBold">Who plays this deck</ThemedText>
              {children.map((c) => {
                const assigned = assignedSet.has(c.id);
                return (
                  <ThemedView key={c.id} type="backgroundElement" style={styles.assignRow}>
                    <ThemedText>
                      {c.avatar ?? '🙂'} {c.display_name}
                    </ThemedText>
                    <Switch value={assigned} onValueChange={() => toggleAssign(c.id, assigned)} />
                  </ThemedView>
                );
              })}
            </>
          )}

          {/* Sharing */}
          <ThemedText type="smallBold">Share</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <Pressable
              style={[styles.shareBtn, duplicating && styles.addBtnDisabled]}
              onPress={duplicateDeck}
              disabled={duplicating}>
              <ThemedText>{duplicating ? 'Duplicating…' : 'Duplicate deck'}</ThemedText>
            </Pressable>
            <Pressable style={styles.shareBtn} onPress={copyShareCode}>
              <ThemedText>Copy share code</ThemedText>
            </Pressable>
            {copyFeedback && (
              <ThemedText themeColor="textSecondary" type="small">{copyFeedback}</ThemedText>
            )}
          </ThemedView>

          {/* Delete */}
          <Pressable style={styles.deleteDeck} onPress={handleDelete}>
            <ThemedText style={styles.deleteDeckText}>
              {confirmingDelete ? 'Tap again to confirm delete' : 'Delete deck'}
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
  centered: { alignItems: 'center', justifyContent: 'center' },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: Spacing.three,
  },
  flex1: { flex: 1 },
  deckEditMultiline: { minHeight: 60, textAlignVertical: 'top' },
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  modeRow: { flexDirection: 'row', gap: Spacing.two },
  addBucketGroup: { gap: Spacing.two },
  modeChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  modeChipActive: { backgroundColor: '#3c87f720', borderColor: '#3c87f7' },
  addBtn: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#ffffff', fontWeight: '600' },
  cardRow: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.three,
  },
  cardRowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cardText: { flex: 1, gap: Spacing.half },
  bucketChip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#888',
  },
  bucketPickerRow: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.two },
  bucketBtn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  bucketBtnActive: { backgroundColor: '#3c87f720', borderColor: '#3c87f7' },
  rowActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  editButtons: { flexDirection: 'row', gap: Spacing.three, justifyContent: 'flex-end' },
  cancelBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  saveBtn: {
    backgroundColor: '#3c87f7',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  shareBtn: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  deleteText: { color: '#d2433f' },
  assignRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  deleteDeck: {
    marginTop: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d2433f',
  },
  deleteDeckText: { color: '#d2433f', fontWeight: '600' },
});
