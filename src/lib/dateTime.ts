export const DEFAULT_TIME_ZONE = 'America/Chicago';

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(preferred?: string): string {
  const cleaned = typeof preferred === 'string' ? preferred.trim() : '';
  if (cleaned && isValidTimeZone(cleaned)) {
    return cleaned;
  }

  // Browser environment: prefer the user's real OS/browser timezone
  if (typeof window !== 'undefined') {
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserTz && isValidTimeZone(browserTz)) {
        return browserTz;
      }
    } catch {
      // Fall through to default
    }
  }

  // Server environment: allow optional APP_TIMEZONE override, defaulting to Central Time
  if (typeof process !== 'undefined' && process.env?.APP_TIMEZONE) {
    const envTz = process.env.APP_TIMEZONE.trim();
    if (envTz && isValidTimeZone(envTz)) {
      return envTz;
    }
  }

  return DEFAULT_TIME_ZONE;
}

export function getClientTimeZone(): string {
  return resolveTimeZone();
}

export function formatIsoDateInTimeZone(
  date: Date = new Date(),
  timeZone?: string
): string {
  const tz = resolveTimeZone(timeZone);
  try {
    // en-CA reliably formats as YYYY-MM-DD
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) {
      return `${y}-${m}-${d}`;
    }
  } catch {
    // Fallback below
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatTimeInTimeZone(
  date: Date = new Date(),
  timeZone?: string
): string {
  const tz = resolveTimeZone(timeZone);
  return date.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatLongDateInTimeZone(
  date: Date = new Date(),
  timeZone?: string
): string {
  const tz = resolveTimeZone(timeZone);
  return date.toLocaleDateString('en-US', {
    timeZone: tz,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getLocalTodayIso(timeZone?: string): string {
  return formatIsoDateInTimeZone(new Date(), timeZone);
}
