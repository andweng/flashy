// Picks the DB implementation at module load.
// EXPO_PUBLIC_USE_MOCK=true (default) → in-memory mock. False → Supabase Cloud.

import { mockDB } from './mock';
import { supabaseDB } from './supabase';
import type { DB } from './types';

const USE_MOCK = (process.env.EXPO_PUBLIC_USE_MOCK ?? 'true') === 'true';

export const db: DB = USE_MOCK ? mockDB : supabaseDB;

export type { DB, CardStateWithCard } from './types';
