/** Small shared formatters for the ops layer (UI panels, crons, drafts). */

import { formatInAppTimeZone } from '@/lib/datetime'

/** Mean of the given ratings, rounded to one decimal place. */
export function averageRating(values: number[]): number {
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

/** "9 Jul, 08:15" — compact timestamp for list rows. Client panels pass the
 *  server's `appTimeZone()` (they cannot read APP_TIME_ZONE). */
export function formatDateTimeShort(iso: string, timeZone?: string): string {
  return formatInAppTimeZone(iso, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}

/** "Wednesday 9 July" — how a session date reads in an email. */
export function formatSessionDateLabel(iso: string): string {
  return formatInAppTimeZone(iso, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** "9 July 2026" — full date for formal references. */
export function formatDateLong(iso: string): string {
  return formatInAppTimeZone(iso, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** "9 July 2026" for a 'YYYY-MM-DD' calendar key such as a newsletter week
 *  start, which is a UTC day rather than an instant. */
export function formatDayKeyLong(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
