/**
 * Pure rate-limit policy for the passwordless sign-in form. The counts come
 * from lib/db/login-links.ts (service DAL over login_link_requests); this
 * module only decides. Kept free of I/O so it is unit-testable.
 */

export const LOGIN_LINK_WINDOW_MINUTES = 15

/** Max sign-in links per email address within the window. */
export const LOGIN_LINK_MAX_PER_EMAIL = 3

/** Max sign-in links per client IP within the window (shared NHS egress IPs
 * mean many legitimate users can sit behind one address — keep this loose). */
export const LOGIN_LINK_MAX_PER_IP = 12

export interface LoginLinkRateDecision {
  allowed: boolean
  /** Human-readable reason, safe to show to the requester. */
  message?: string
}

export function evaluateLoginLinkRateLimit(counts: {
  emailCount: number
  ipCount: number
}): LoginLinkRateDecision {
  if (counts.emailCount >= LOGIN_LINK_MAX_PER_EMAIL) {
    return {
      allowed: false,
      message: `We've already sent several sign-in links to that address. Check your inbox (and spam folder), or try again in ${LOGIN_LINK_WINDOW_MINUTES} minutes.`,
    }
  }
  if (counts.ipCount >= LOGIN_LINK_MAX_PER_IP) {
    return {
      allowed: false,
      message: `Too many sign-in requests from your network. Please try again in ${LOGIN_LINK_WINDOW_MINUTES} minutes.`,
    }
  }
  return { allowed: true }
}

/** First hop of x-forwarded-for, else x-real-ip, else null. */
export function clientIpFromHeaders(headers: {
  get(name: string): string | null
}): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || null
}
