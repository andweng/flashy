import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useCurrentChild } from '@/lib/current-child';

// Anchor the stack to home so a cold load / web refresh of a nested screen
// (e.g. /review, /decks/[id]) still has a back target — otherwise the fresh
// navigation stack has no history and the header shows no back arrow.
export const unstable_settings = {
  initialRouteName: 'home',
};

export default function AppLayout() {
  const { child, hydrated } = useCurrentChild();
  const router = useRouter();

  // Guard: if we land here without a selected child, bounce to the picker — but
  // wait for the persisted selection to load first, or a refresh would bounce
  // before it can be restored.
  useEffect(() => {
    if (hydrated && !child) router.replace('/');
  }, [child, hydrated, router]);

  return (
    <Stack>
      <Stack.Screen name="home" options={{ title: 'Home' }} />
      <Stack.Screen name="decks" options={{ title: 'Decks' }} />
      <Stack.Screen name="review" options={{ title: 'Review' }} />
      <Stack.Screen name="settings" options={{ title: 'Profile' }} />
    </Stack>
  );
}
