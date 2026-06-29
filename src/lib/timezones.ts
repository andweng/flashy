// Timezone helpers for the parent settings picker. Scheduling reads the
// parent's IANA zone (see lib/today.ts) to decide which calendar day "today" is.

// This device's IANA zone, e.g. 'America/Los_Angeles'. Falls back to UTC if the
// runtime can't resolve one.
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// Every IANA zone name, for the override list. Prefers the runtime's own list
// (Intl.supportedValuesOf — present on newer Hermes/web) and falls back to a
// bundled set of common zones when it isn't available.
export function listTimezones(): string[] {
  const supportedValuesOf = (Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  }).supportedValuesOf;
  if (typeof supportedValuesOf === 'function') {
    try {
      const zones = supportedValuesOf('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      // fall through to bundled list
    }
  }
  return FALLBACK_TIMEZONES;
}

// Common zones used when Intl.supportedValuesOf is unavailable. Not exhaustive,
// but covers the major populated zones across every continent.
const FALLBACK_TIMEZONES: string[] = [
  'UTC',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Bogota',
  'America/Lima',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Halifax',
  'America/St_Johns',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Rome',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Prague',
  'Europe/Warsaw',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Casablanca',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Jerusalem',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Tehran',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Taipei',
  'Asia/Manila',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];
