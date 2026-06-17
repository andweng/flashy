import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useCurrentChild } from '@/lib/current-child';

export default function AppLayout() {
  const { child } = useCurrentChild();
  const router = useRouter();

  // Guard: if we land here without a selected child, bounce to the picker.
  useEffect(() => {
    if (!child) router.replace('/');
  }, [child, router]);

  return (
    <Stack>
      <Stack.Screen name="home" options={{ title: 'Home' }} />
      <Stack.Screen name="decks" options={{ title: 'Decks' }} />
      <Stack.Screen name="review" options={{ title: 'Review' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
