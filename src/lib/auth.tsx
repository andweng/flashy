// Session tracking + sign-in/out. In mock mode the session is synthesized as
// "always signed in" so the UI gates pass and we can develop without touching
// Supabase; in cloud mode it mirrors the real supabase-js session.

import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from './supabase';

const USE_MOCK = (process.env.EXPO_PUBLIC_USE_MOCK ?? 'true') === 'true';

type AuthState = {
  session: Session | null;
  ready: boolean;
  signedIn: boolean;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(USE_MOCK);

  useEffect(() => {
    if (USE_MOCK) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        ready,
        signedIn: USE_MOCK || !!session,
        signOut: async () => {
          if (USE_MOCK) return;
          await supabase.auth.signOut();
        },
        changePassword: async (newPassword: string) => {
          if (USE_MOCK) throw new Error('Password change is unavailable in mock mode.');
          const { error } = await supabase.auth.updateUser({ password: newPassword });
          if (error) throw error;
        },
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
