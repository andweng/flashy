// Tracks which child profile is "playing" right now. Provided at the root layout.
//
// The selection is persisted to AsyncStorage so a web refresh (which wipes all
// in-memory state) keeps you on the same profile instead of bouncing to the
// picker via the (app) layout guard. `hydrated` tells that guard to wait for the
// stored selection to load before deciding no child is set.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '@/lib/auth';
import type { Child } from '@/types/domain';

const STORAGE_KEY = 'current-child:v1';

type Ctx = {
  child: Child | null;
  setChild: (c: Child | null) => void;
  // False until the persisted selection has been read back on mount.
  hydrated: boolean;
};

const CurrentChildContext = createContext<Ctx | null>(null);

export function CurrentChildProvider({ children }: { children: ReactNode }) {
  const { ready, signedIn } = useAuth();
  const [child, setChildState] = useState<Child | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore the last-selected profile once, on mount.
  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setChildState(JSON.parse(raw) as Child);
      } catch {
        // Ignore malformed / unavailable storage — just start with no child.
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Drop the persisted profile when the account signs out, so a different
  // account can't resume the previous one's child. Gate on `ready` so the
  // pre-session window on a fresh cloud load (signedIn briefly false) doesn't
  // wipe a legitimately stored selection.
  useEffect(() => {
    if (ready && !signedIn) {
      // Reset in-memory state to match the external auth system signing out.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChildState(null);
      void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    }
  }, [ready, signedIn]);

  function setChild(c: Child | null) {
    setChildState(c);
    if (c) void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(c)).catch(() => {});
    else void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }

  return (
    <CurrentChildContext.Provider value={{ child, setChild, hydrated }}>
      {children}
    </CurrentChildContext.Provider>
  );
}

export function useCurrentChild() {
  const ctx = useContext(CurrentChildContext);
  if (!ctx) throw new Error('useCurrentChild must be used inside CurrentChildProvider');
  return ctx;
}
