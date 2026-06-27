// "Effective today" for a child, derived from the real calendar day plus that
// child's `day_offset` (how many days into their Leitner cycle they are).
// The offset is per-child (stored on the child record) — pass it in explicitly.
// Reads should go through getEffectiveToday() rather than touching `new Date()`.

import { addDays, todayInTz } from './leitner';

export function getEffectiveToday(timezone: string = 'UTC', dayOffset: number = 0): string {
  const real = todayInTz(timezone);
  return dayOffset === 0 ? real : addDays(real, dayOffset);
}
