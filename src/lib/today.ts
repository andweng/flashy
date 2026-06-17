// "Today" offset for development / migration planning.
// The offset is an integer number of days added to the real calendar today.
// Stored in AsyncStorage so it survives reloads. Reads should go through
// getEffectiveToday() rather than touching `new Date()` directly.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { addDays, todayInTz } from './leitner';

const STORAGE_KEY = 'flashy.today_day_offset';
let cachedOffset = 0;
let inited = false;

export async function initToday(): Promise<void> {
  if (inited) return;
  const v = await AsyncStorage.getItem(STORAGE_KEY);
  const n = v == null ? 0 : parseInt(v, 10);
  cachedOffset = Number.isFinite(n) ? n : 0;
  inited = true;
}

export function getDayOffset(): number {
  return cachedOffset;
}

export async function setDayOffset(n: number): Promise<void> {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error('Day must be a non-negative integer.');
  }
  cachedOffset = n;
  if (n === 0) await AsyncStorage.removeItem(STORAGE_KEY);
  else await AsyncStorage.setItem(STORAGE_KEY, String(n));
}

export function getEffectiveToday(timezone: string = 'UTC'): string {
  const real = todayInTz(timezone);
  return cachedOffset === 0 ? real : addDays(real, cachedOffset);
}
