// Tracks which child profile is "playing" right now. Provided at the root layout.

import { createContext, useContext, useState, type ReactNode } from 'react';

import type { Child } from '@/types/domain';

type Ctx = {
  child: Child | null;
  setChild: (c: Child | null) => void;
};

const CurrentChildContext = createContext<Ctx | null>(null);

export function CurrentChildProvider({ children }: { children: ReactNode }) {
  const [child, setChild] = useState<Child | null>(null);
  return (
    <CurrentChildContext.Provider value={{ child, setChild }}>
      {children}
    </CurrentChildContext.Provider>
  );
}

export function useCurrentChild() {
  const ctx = useContext(CurrentChildContext);
  if (!ctx) throw new Error('useCurrentChild must be used inside CurrentChildProvider');
  return ctx;
}
