import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * Weekly learning-points newsletter: pure helpers (week windowing, schema,
 * HTML rendering, unsubscribe tokens). Drafting lives in the ops-newsletter
 * cron; sending happens only in the NEWSLETTER_ISSUE executor after human
 * approval.
 */

export interface WeekWindow {
  /** Monday 00:00 UTC of the most recent COMPLETE week. */
  weekStart: Date
  /** Exclusive end: the following Monday 00:00 UTC. */
  weekEnd: Date
  /** YYYY-MM-DD of weekStart — the ops_newsletter_issues natural key. */
  weekStartKey: string
}

/** The most recent complete Mon–Sun week strictly before `now` (UTC). */
export function newsletterWeekWindow(now: Date): WeekWindow {
  const day = now.getUTCDay() // 0 = Sunday ... 6 = Saturday
  const daysSinceMonday = (day + 6) % 7
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
  const weekEnd = new Date(thisMonday)
  const weekStart = new Date(thisMonday - 7 * 24 * 60 * 60 * 1000)
  return {
    weekStart,
    weekEnd,
    weekStartKey: weekStart.toISOString().slice(0, 10),
  }
}

export const NewsletterSchema = z.object({
  subject: z.string().min(1).max(150),
  intro: z.string().min(1),
  learning_points: z
    .array(z.object({ title: z.string().min(1), detail: z.string().min(1) }))
    .min(1)
    .max(8),
  looking_ahead: z.string(),
})

export type NewsletterContent = z.infer<typeof NewsletterSchema>

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Replaced per-recipient by the executor with a signed unsubscribe URL. */
export const UNSUBSCRIBE_PLACEHOLDER = '%%UNSUBSCRIBE_URL%%'

export function buildNewsletterHtml(input: {
  orgName: string
  weekLabel: string
  content: NewsletterContent
}): string {
  const points = input.content.learning_points
    .map(
      (point) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #ddd;">
            <p style="margin:0 0 4px;font-weight:bold;">${escapeHtml(point.title)}</p>
            <p style="margin:0;color:#333;">${escapeHtml(point.detail)}</p>
          </td>
        </tr>`
    )
    .join('')

  const lookingAhead = input.content.looking_ahead.trim()
    ? `<h3 style="margin:24px 0 8px;">Coming up</h3>
       <p style="margin:0;color:#333;">${escapeHtml(input.content.looking_ahead)}</p>`
    : ''

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <p style="margin:0;font-size:12px;color:#666;">${escapeHtml(input.orgName)} — weekly teaching digest</p>
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;margin:4px 0 16px;">${escapeHtml(input.content.subject)}</h2>
      <p style="margin:0 0 8px;font-size:12px;color:#666;">${escapeHtml(input.weekLabel)}</p>
      <p style="margin:0 0 16px;">${escapeHtml(input.content.intro)}</p>
      <h3 style="margin:0 0 8px;">Learning points</h3>
      <table style="width:100%;border-collapse:collapse;">${points}</table>
      ${lookingAhead}
      <p style="font-size:12px;color:#666;margin-top:24px;border-top:1px solid #ccc;padding-top:10px;">
        Sent by Petrios after review by your teaching programme organisers.
        <a href="${UNSUBSCRIBE_PLACEHOLDER}" style="color:#666;">Unsubscribe from this digest</a>
      </p>
    </div>
  `
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens: HMAC-signed orgId+userId so links work without a login
// but cannot be forged or enumerated. Secret defaults to the service-role key
// (server-only, same trick as the ICS calendar feed).
// ---------------------------------------------------------------------------

function unsubSecret(secret?: string): string {
  const resolved = secret ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!resolved) throw new Error('Unsubscribe token secret is not configured')
  return resolved
}

function signUnsubPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32)
}

export function makeUnsubToken(orgId: string, userId: string, secret?: string): string {
  const sig = signUnsubPayload(`${orgId}.${userId}`, unsubSecret(secret))
  // UUIDs contain no dots, so '.' is a safe separator.
  return `${orgId}.${userId}.${sig}`
}

export function verifyUnsubToken(
  token: string,
  secret?: string
): { orgId: string; userId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [orgId, userId, sig] = parts
  const expected = signUnsubPayload(`${orgId}.${userId}`, unsubSecret(secret))
  if (sig.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return { orgId, userId }
}
