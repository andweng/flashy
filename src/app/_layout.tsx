import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';

import { AuthProvider } from '@/lib/auth';
import { CurrentChildProvider } from '@/lib/current-child';
import { ThemePreferenceProvider, useResolvedColorScheme } from '@/lib/theme-preference';

function ThemedStack() {
  const colorScheme = useResolvedColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="add-child" options={{ title: 'Add child' }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <AuthProvider>
        <CurrentChildProvider>
          <ThemedStack />
        </CurrentChildProvider>
      </AuthProvider>
    </ThemePreferenceProvider>
  );
}
