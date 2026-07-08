/**
 * Session duration helpers. Sessions are entered as start + duration in the
 * UI, but date_end stays stored in the DB (calendar, ICS feed, attendance
 * windows and certificates all read it) — these helpers convert between the
 * two representations.
 */

export const DURATION_STEP_MINS = 30
export const MIN_SESSION_DURATION_MINS = 30
export const MAX_SESSION_DURATION_MINS = 240

/** [30, 60, ..., 240] */
export function listDurationOptions(): number[] {
  const options: number[] = []
  for (
    let mins = MIN_SESSION_DURATION_MINS;
    mins <= MAX_SESSION_DURATION_MINS;
    mins += DURATION_STEP_MINS
  ) {
    options.push(mins)
  }
  return options
}

/** '30 minutes', '1 hour', '1 hour 30 minutes', '2 hours', ... */
export function formatDuration(mins: number): string {
  const hours = Math.floor(mins / 60)
  const minutes = mins % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0) parts.push(`${minutes} minutes`)
  return parts.join(' ') || '0 minutes'
}

export function computeDateEnd(dateStartIso: string, durationMins: number): string {
  const start = new Date(dateStartIso)
  if (Number.isNaN(start.getTime())) {
    throw new Error('Session start time is invalid')
  }
  return new Date(start.getTime() + durationMins * 60 * 1000).toISOString()
}

/**
 * Duration in minutes between two dates, snapped to the 30-minute grid
 * (nearest step, ties round up: 105 min -> 120) and clamped to 30–240.
 * Callers that must not shift a legacy off-grid end time should use
 * exactDurationFromDates and keep the exact value as an extra option.
 */
export function durationFromDates(startIso: string, endIso: string): number {
  const exact = exactDurationFromDates(startIso, endIso)
  const snapped = Math.round(exact / DURATION_STEP_MINS) * DURATION_STEP_MINS
  return Math.min(
    MAX_SESSION_DURATION_MINS,
    Math.max(MIN_SESSION_DURATION_MINS, snapped)
  )
}

/** Unsnapped whole-minute duration between two dates (min 0). */
export function exactDurationFromDates(startIso: string, endIso: string): number {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / (60 * 1000)))
}
