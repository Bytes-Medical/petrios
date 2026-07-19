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
