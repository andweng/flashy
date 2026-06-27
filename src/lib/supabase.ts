import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// During static rendering on the web, `window` doesn't exist and AsyncStorage's
// localStorage adapter throws. No-op the storage on the server; on the client
// (browser or native) fall through to AsyncStorage.
const isServer = typeof window === 'undefined';
const ssrSafeStorage = {
  getItem: async (key: string) => (isServer ? null : AsyncStorage.getItem(key)),
  setItem: async (key: string, value: string) => {
    if (!isServer) await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (!isServer) await AsyncStorage.removeItem(key);
  },
};

// Placeholders let createClient construct cleanly during static rendering when env
// vars are absent. Actual queries are gated by EXPO_PUBLIC_USE_MOCK in lib/db/index.ts
// and lib/auth.tsx, so the placeholder client is never called over the network.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
   
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing — client will only work in mock mode.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: ssrSafeStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
