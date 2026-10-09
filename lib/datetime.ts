const DEFAULT_TIME_ZONE = 'Europe/London'

// Resolved zone per configured value: formatting runs per date in crons, so
// validate (and log an invalid value) once rather than on every call.
const resolvedZones = new Map<string, string>()

/**
 * Time zone for dates rendered on the server (pages, emails, PDFs, crons).
 * Server clocks are UTC (always on Cloudflare Workers, usually in Docker), so
 * formatting without an explicit zone shows UK sessions an hour early in BST.
 *
 * Server-only: the browser has no APP_TIME_ZONE and resolves the default.
 * Client components rendered during SSR take the server's value as a prop
 * and pass it as `timeZone`, so server and browser render the same text.
 */
export function appTimeZone(
  // Guarded because client components share some of these helpers.
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env
): string {
  const configured = env.APP_TIME_ZONE?.trim()
  if (!configured) return DEFAULT_TIME_ZONE
  const cached = resolvedZones.get(configured)
  if (cached) return cached

  let zone = DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: configured })
    zone = configured
  } catch {
    console.error(`[datetime] Ignoring invalid APP_TIME_ZONE "${configured}"; using ${DEFAULT_TIME_ZONE}`)
  }
  resolvedZones.set(configured, zone)
  return zone
}

/** Formats in the app time zone, or in `options.timeZone` when a caller passes one. */
export function formatInAppTimeZone(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-GB'
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: options.timeZone ?? appTimeZone(),
  }).format(new Date(value))
}

/** "09/10/2026" — the app-zone equivalent of toLocaleDateString('en-GB'). */
export function formatAppDate(value: Date | string | number): string {
  return formatInAppTimeZone(value, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** "09/10/2026, 16:15:00" — the app-zone equivalent of toLocaleString('en-GB'). */
export function formatAppDateTime(value: Date | string | number): string {
  return formatInAppTimeZone(value, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface WallClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClockParts(epochMs: number, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value)
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  }
}

function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const wholeSecond = Math.floor(epochMs / 1000) * 1000
  const p = wallClockParts(wholeSecond, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wholeSecond
}

/** 'YYYY-MM-DD' of the calendar day an instant falls on in the app time zone. */
export function appDayKey(value: Date | string | number = new Date()): string {
  const p = wallClockParts(new Date(value).getTime(), appTimeZone())
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * UTC ISO instant for a 'YYYY-MM-DDTHH:mm' wall-clock time in the app time
 * zone. A spring-forward time that does not exist resolves an hour later.
 */
export function appWallClockToIso(local: string): string {
  const match = WALL_CLOCK_RE.exec(local)
  if (!match) throw new Error(`Invalid local date and time: ${local}`)
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  const timeZone = appTimeZone()
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const guess = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone)
  return new Date(wallAsUtc - zoneOffsetMs(guess, timeZone)).toISOString()
}
