// Device-local light/dark preference. Theme is a per-device choice (not account
// data), so it lives in AsyncStorage rather than the parent row. 'system'
// follows the OS; 'light'/'dark' force a scheme. Mounted in app/_layout so both
// useTheme() and the navigation ThemeProvider resolve through it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme as useSystemColorScheme } from 'react-native';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  colorScheme: ResolvedScheme;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: React.ReactNode }) {
  // useColorScheme() can return null on the first render(s) and, on a cold start,
  // may only resolve via an Appearance change event that never fires — leaving a
  // dark device stuck on light. Reading Appearance synchronously patches that
  // initial null; the hook still drives live updates once it has a value.
  const system = useSystemColorScheme() ?? Appearance.getColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    void (async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    })();
  }, []);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }

  const colorScheme: ResolvedScheme =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo(
    () => ({ preference, setPreference, colorScheme }),
    [preference, colorScheme],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>
  );
}

// Full control surface for the settings toggle.
export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) throw new Error('useThemePreference must be used within ThemePreferenceProvider');
  return ctx;
}

// Resolved 'light' | 'dark', honoring the saved preference. Falls back to the
// system scheme when no provider is mounted (e.g. static web render).
export function useResolvedColorScheme(): ResolvedScheme {
  const ctx = useContext(ThemePreferenceContext);
  const system = useSystemColorScheme() ?? Appearance.getColorScheme();
  if (ctx) return ctx.colorScheme;
  return system === 'dark' ? 'dark' : 'light';
}
