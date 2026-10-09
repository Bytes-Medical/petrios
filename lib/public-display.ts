/**
 * Public-site Display mode (spec/13 "Cookies posture", spec/07 public site
 * design system). Day is the default and stores nothing; Night and Match
 * device are remembered in a first-party preference cookie that HudShell
 * reads on the server, so every render is correct without an inline script.
 */

export const DISPLAY_COOKIE = 'petrios-display'

export type Display = 'day' | 'night' | 'auto'

export const DISPLAY_OPTIONS: ReadonlyArray<{ value: Display; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'night', label: 'Night' },
  { value: 'auto', label: 'Match device' },
]

/** 180 days: "up to 6 months" in the /privacy disclosure. */
export const DISPLAY_COOKIE_MAX_AGE = 15_552_000

export function parseDisplay(value?: string | null): Display {
  return value === 'night' || value === 'auto' ? value : 'day'
}

/** A `document.cookie` assignment; choosing Day deletes the cookie. */
export function displayCookie(display: Display, secure: boolean): string {
  const maxAge = display === 'day' ? 0 : DISPLAY_COOKIE_MAX_AGE
  const value = display === 'day' ? '' : display
  return `${DISPLAY_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`
}

/**
 * Reads the Display mode from a `Cookie` header or `document.cookie` string.
 * A duplicated name resolves to its last occurrence, as Next's server-side
 * `cookies()` does, so HudShell and DisplayControl always agree.
 */
export function displayFromCookieString(cookies: string): Display {
  let value: string | undefined
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === DISPLAY_COOKIE) value = part.slice(separator + 1).trim()
  }
  return parseDisplay(value)
}
