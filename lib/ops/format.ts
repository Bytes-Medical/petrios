/** Small shared formatters for the ops layer (UI panels, crons, drafts). */

/** Mean of the given ratings, rounded to one decimal place. */
export function averageRating(values: number[]): number {
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
}

/** "9 Jul, 08:15" — compact timestamp for list rows. */
export function formatDateTimeShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "Wednesday 9 July" — how a session date reads in an email. */
export function formatSessionDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** "9 July 2026" — full date for formal references. */
export function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
