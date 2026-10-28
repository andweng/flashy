import { type ComponentType } from 'react';
import { Modal, Switch } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import DeckDetailScreen from '@/app/(app)/decks/[id]';
import DecksScreen from '@/app/(app)/decks/index';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { ThemedText } from '@/components/themed-text';
import { db } from '@/lib/db';
import type { Card, Child, Deck } from '@/types/domain';

jest.mock('@/global.css', () => ({}));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ text: '#000', textSecondary: '#666', background: '#fff' }),
}));
jest.mock('@/lib/current-child', () => ({ useCurrentChild: () => ({ child: mockChild }) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'deck-1' }),
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/lib/db', () => ({
  db: {
    getCurrentParent: jest.fn(),
    getDeck: jest.fn(),
    listDecksForParent: jest.fn(),
    listCardsInDeck: jest.fn(),
    listDeckAssignments: jest.fn(),
    listChildren: jest.fn(),
    listCardStatesForChild: jest.fn(),
    getDeckAssignment: jest.fn(),
    deleteCard: jest.fn(),
    deleteDeck: jest.fn(),
    unassignDeckFromChild: jest.fn(),
  },
}));

const mockChild: Child = {
  id: 'child-1', parent_id: 'parent-1', display_name: 'Sam', avatar: null,
  graduate_after_passes: null, permanent_draws_per_day: 0,
};
const deck: Deck = {
  id: 'deck-1', parent_id: 'parent-1', name: 'Vocabulary', description: null,
  bucket_intervals_days: [1, 2, 4],
};
const card: Card = {
  id: 'card-1', deck_id: deck.id, front: 'hello', back: 'hola',
  grading_mode: 'self_grade', typed_alternates: [], choices: [],
};
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockDb = jest.mocked(db);
let tree: ReactTestRenderer;

async function render(Screen: ComponentType) {
  await act(async () => { tree = create(<Screen />); });
}

async function press(root: ReactTestInstance, label: string) {
  const button = root.findAll((node) => typeof node.props.onPress === 'function').find((node) =>
    node.props.accessibilityLabel === label ||
    node.findAllByType(ThemedText).some((text) => text.props.children === label),
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  await act(async () => { await button.props.onPress(); });
}

function expectNoRemoval() {
  expect(mockDb.deleteCard).not.toHaveBeenCalled();
  expect(mockDb.deleteDeck).not.toHaveBeenCalled();
  expect(mockDb.unassignDeckFromChild).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.getCurrentParent.mockResolvedValue({ id: 'parent-1', display_name: null, timezone: 'UTC' });
  mockDb.getDeck.mockResolvedValue(deck);
  mockDb.listDecksForParent.mockResolvedValue([deck]);
  mockDb.listCardsInDeck.mockResolvedValue([card]);
  mockDb.listDeckAssignments.mockResolvedValue([mockChild.id]);
  mockDb.listChildren.mockResolvedValue([mockChild]);
  mockDb.listCardStatesForChild.mockResolvedValue([]);
  mockDb.getDeckAssignment.mockResolvedValue(null);
  mockDb.deleteCard.mockResolvedValue(undefined);
  mockDb.deleteDeck.mockResolvedValue(undefined);
  mockDb.unassignDeckFromChild.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it('only opens the editor from the deck list, with no removal button', async () => {
  await render(DecksScreen);
  expect(tree.root.findAllByType(ThemedText).some((node) => node.props.children === 'Remove')).toBe(false);
  expect(tree.root.findAll((node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('Remove'))).toHaveLength(0);
  await press(tree.root, 'Vocabulary');
  expect(mockPush).toHaveBeenCalledWith('/decks/deck-1');
  expectNoRemoval();
});

it.each([
  { name: 'turning off a deck assignment', Screen: DeckDetailScreen, trigger: null, label: 'Remove deck', target: 'Sam', method: 'unassignDeckFromChild', args: ['deck-1', 'child-1'] },
  { name: 'deleting a card', Screen: DeckDetailScreen, trigger: 'Delete card: hello', label: 'Delete card', target: 'hello', method: 'deleteCard', args: ['card-1'] },
  { name: 'deleting a deck', Screen: DeckDetailScreen, trigger: 'Delete deck', label: 'Delete deck', target: 'Vocabulary', method: 'deleteDeck', args: ['deck-1'] },
] as const)('$name requires a separate confirmation and supports cancellation', async (testCase) => {
  await render(testCase.Screen);
  async function open() {
    if (testCase.trigger) await press(tree.root, testCase.trigger);
    else await act(async () => { tree.root.findByType(Switch).props.onValueChange(false); });
  }

  await open();
  expectNoRemoval();
  expect(tree.root.findByType(ConfirmationDialog).props.message).toContain(testCase.target);
  await press(tree.root.findByType(ConfirmationDialog), 'Cancel');
  expectNoRemoval();
  expect(tree.root.findAllByType(ConfirmationDialog)).toHaveLength(0);

  await open();
  expectNoRemoval();
  await press(tree.root.findByType(ConfirmationDialog), testCase.label);
  expect(mockDb[testCase.method]).toHaveBeenCalledTimes(1);
  expect(mockDb[testCase.method]).toHaveBeenCalledWith(...testCase.args);
  expect(tree.root.findAllByType(ConfirmationDialog)).toHaveLength(0);
  if (testCase.method === 'deleteDeck') expect(mockReplace).toHaveBeenCalledWith('/decks');
  if (testCase.method === 'deleteCard') {
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Delete card: hello' })).toHaveLength(0);
  }
  if (testCase.trigger === null) expect(tree.root.findByType(Switch).props.value).toBe(false);
});

it('dismisses a confirmation with the system back action without removing anything', async () => {
  await render(DeckDetailScreen);
  await press(tree.root, 'Delete card: hello');
  await act(async () => { tree.root.findByType(Modal).props.onRequestClose(); });
  expectNoRemoval();
  expect(tree.root.findAllByType(ConfirmationDialog)).toHaveLength(0);
});

it('submits only once while a deletion is pending', async () => {
  let resolveDeletion!: () => void;
  mockDb.deleteCard.mockReturnValueOnce(new Promise<void>((resolve) => { resolveDeletion = resolve; }));
  await render(DeckDetailScreen);
  await press(tree.root, 'Delete card: hello');
  const confirm = tree.root.findByType(ConfirmationDialog)
    .findAll((node) => node.props.accessibilityLabel === 'Delete card' && typeof node.props.onPress === 'function')[0];

  await act(async () => {
    void confirm.props.onPress();
    void confirm.props.onPress();
  });
  expect(mockDb.deleteCard).toHaveBeenCalledTimes(1);
  expect(confirm.props.disabled).toBe(true);
  await act(async () => { tree.root.findByType(Modal).props.onRequestClose(); });
  expect(tree.root.findAllByType(ConfirmationDialog)).toHaveLength(1);
  await act(async () => { resolveDeletion(); });
  expect(tree.root.findAllByType(ConfirmationDialog)).toHaveLength(0);
});

it('keeps the card and offers retry when deletion fails', async () => {
  mockDb.deleteCard.mockRejectedValueOnce(new Error('Offline'));
  await render(DeckDetailScreen);
  await press(tree.root, 'Delete card: hello');
  await press(tree.root.findByType(ConfirmationDialog), 'Delete card');
  expect(tree.root.findAllByType(ThemedText).some((node) => node.props.accessibilityRole === 'alert')).toBe(true);
  expect(tree.root.findAllByProps({ accessibilityLabel: 'Delete card: hello' }).length).toBeGreaterThan(0);

  await press(tree.root.findByType(ConfirmationDialog), 'Delete card');
  expect(mockDb.deleteCard).toHaveBeenCalledTimes(2);
  expect(tree.root.findAllByType(ConfirmationDialog)).toHaveLength(0);
});
