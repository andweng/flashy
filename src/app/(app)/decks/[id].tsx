import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { db } from '@/lib/db';
import { serializeDeck } from '@/lib/deck-export';
import type { Card, Child, Deck, GradingMode } from '@/types/domain';

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [assignedSet, setAssignedSet] = useState<Set<string>>(new Set());

  // Quick-add form
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [mode, setMode] = useState<GradingMode>('self_grade');
  const [addPending, setAddPending] = useState(false);

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
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function addCard() {
    if (!deck) return;
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) return;
    setAddPending(true);
    try {
      await db.createCard({
        deck_id: deck.id,
        front: f,
        back: b,
        grading_mode: mode,
        typed_alternates: [],
      });
      setFront('');
      setBack('');
      await refresh();
    } finally {
      setAddPending(false);
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
    if (!f || !b) return;
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
        <SafeAreaView style={[styles.safe, styles.centered]}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="title">{deck.name}</ThemedText>
          {deck.description && (
            <ThemedText themeColor="textSecondary">{deck.description}</ThemedText>
          )}

          {/* Quick-add card */}
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">Add card</ThemedText>
            <TextInput
              value={front}
              onChangeText={setFront}
              placeholder="Front"
              placeholderTextColor={theme.textSecondary}
              editable={!addPending}
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
            />
            <TextInput
              value={back}
              onChangeText={setBack}
              placeholder="Back"
              placeholderTextColor={theme.textSecondary}
              editable={!addPending}
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
            <Pressable
              style={[styles.addBtn, (!front.trim() || !back.trim() || addPending) && styles.addBtnDisabled]}
              onPress={addCard}
              disabled={!front.trim() || !back.trim() || addPending}>
              <ThemedText style={styles.addBtnText}>{addPending ? '…' : 'Add card'}</ThemedText>
            </Pressable>
          </ThemedView>

          {/* Card list */}
          <ThemedText type="smallBold">{cards.length} card{cards.length === 1 ? '' : 's'}</ThemedText>
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
                  placeholder="Back"
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
                    style={[styles.saveBtn, (!editFront.trim() || !editBack.trim() || editPending) && styles.addBtnDisabled]}
                    disabled={!editFront.trim() || !editBack.trim() || editPending}>
                    <ThemedText style={styles.addBtnText}>{editPending ? '…' : 'Save'}</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ) : (
              <ThemedView key={card.id} type="backgroundElement" style={styles.cardRow}>
                <Pressable style={styles.cardText} onPress={() => startEdit(card)}>
                  <ThemedText>{card.front}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">{card.back}</ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {card.grading_mode === 'typed' ? 'typed' : 'self-grade'}
                  </ThemedText>
                </Pressable>
                <View style={styles.rowActions}>
                  <Pressable onPress={() => startEdit(card)}>
                    <ThemedText themeColor="textSecondary">Edit</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => removeCard(card.id)}>
                    <ThemedText style={styles.deleteText}>Delete</ThemedText>
                  </Pressable>
                </View>
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
  section: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  input: {
    fontSize: 16,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.two,
  },
  modeRow: { flexDirection: 'row', gap: Spacing.two },
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.three,
  },
  cardText: { flex: 1, gap: Spacing.half },
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
