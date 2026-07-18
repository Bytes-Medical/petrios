import { createHmac } from 'node:crypto'

export const GROUP_CODE_WINDOW_MINUTES = 10
export const GROUP_CODE_MAX_PER_USER = 6
export const GROUP_CODE_MAX_PER_IP = 30

/**
 * Pseudonymise an IP with a server secret so the rate-limit table does not
 * contain raw addresses or hashes that are practical to reverse by enumeration.
 * User-based throttling remains active when no suitable secret is configured.
 */
export function hashAttendanceRateLimitIp(ip: string | null): string | null {
  if (!ip) return null
  const secret =
    process.env.ATTENDANCE_RATE_LIMIT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) return null
  return createHmac('sha256', secret).update(ip).digest('hex')
}

export function groupCodeAttemptAllowed(input: { userCount: number; ipCount: number }): boolean {
  return input.userCount < GROUP_CODE_MAX_PER_USER && input.ipCount < GROUP_CODE_MAX_PER_IP
}
