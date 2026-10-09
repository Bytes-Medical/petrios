const INTERNAL_ORIGIN = 'https://petrios.invalid'

/** Prevent login continuation parameters becoming open redirects. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard'
  }
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN)
    if (parsed.origin !== INTERNAL_ORIGIN) return '/dashboard'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/dashboard'
  }
}

/** Paths that are already the post-sign-in default: no continuation needed. */
const DEFAULT_LANDING = new Set(['/', '/dashboard', '/login'])

/**
 * The sign-in URL for a signed-out visitor who asked for `pathname` +
 * `search`, carrying the request as `next` so links that need an account
 * (a reminder email's video-room link, an ICS event URL) land back on that
 * page after sign-in instead of /dashboard. Next's internal `_rsc` cache key
 * is dropped. Only same-origin paths survive (safeNextPath).
 */
export function loginUrlFor(pathname: string, search = ''): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete('_rsc')
  const query = params.toString()
  const requested = `${pathname}${query ? `?${query}` : ''}`
  const next = safeNextPath(requested)
  if (DEFAULT_LANDING.has(next) || next !== requested) return '/login'
  return `/login?next=${encodeURIComponent(next)}`
}
