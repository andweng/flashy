// "Today" for a child, in the parent's timezone. Repositioning a child's schedule
// now rewrites their card due dates (see dueDateForCycleDay), so reads compare
// against the real calendar day — there is no longer a per-child read-time offset.

import { todayInTz } from './leitner';

export function getEffectiveToday(timezone: string = 'UTC'): string {
  return todayInTz(timezone);
}
