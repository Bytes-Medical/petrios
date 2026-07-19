import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { OpsNewsletterContent } from '@/lib/types'

/**
 * Department weekly teaching newsletter: pure helpers (week windowing,
 * one-page content validation, HTML rendering, unsubscribe tokens). A
 * moderator explicitly starts generation and reviews the exact draft before
 * the NEWSLETTER_ISSUE executor may send it.
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

/** Validate an explicitly selected Monday-Sunday UTC week that has started.
 *  Mid-week drafts are deliberate: generation only reads sessions that have
 *  ENDED inside the window, and a draft is regenerable until it is sent, so
 *  an early draft simply covers the week so far. */
export function newsletterWindowFromWeekStart(
  weekStartKey: string,
  now = new Date()
): WeekWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartKey)) {
    throw new Error('Choose a valid week start date')
  }
  const weekStart = new Date(`${weekStartKey}T00:00:00.000Z`)
  if (Number.isNaN(weekStart.getTime()) || weekStart.toISOString().slice(0, 10) !== weekStartKey) {
    throw new Error('Choose a valid week start date')
  }
  if (weekStart.getUTCDay() !== 1) throw new Error('The newsletter week must start on a Monday')
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  if (weekStart.getTime() > now.getTime()) {
    throw new Error("That week hasn't started yet — pick the current or a past week")
  }
  if (weekStart.getTime() < now.getTime() - 366 * 24 * 60 * 60 * 1000) {
    throw new Error('Newsletter generation is limited to the last year')
  }
  return { weekStart, weekEnd, weekStartKey }
}

export const NEWSLETTER_MAX_WORDS = 700

const NewsletterSessionSchema = z.object({
  session_id: z.string().uuid(),
  title: z.string().trim().min(1).max(180),
  date_label: z.string().trim().min(1).max(100),
  overview: z.string().trim().min(1).max(650),
  learning_points: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
})

export const NewsletterSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  intro: z.string().trim().min(1).max(650),
  sessions: z.array(NewsletterSessionSchema).min(1).max(50),
  closing: z.string().trim().min(1).max(500),
}).superRefine((content, context) => {
  if (newsletterWordCount(content) > NEWSLETTER_MAX_WORDS) {
    context.addIssue({
      code: 'custom',
      message: `Keep the complete newsletter to ${NEWSLETTER_MAX_WORDS} words or fewer`,
    })
  }
})

export type NewsletterContent = z.infer<typeof NewsletterSchema>

export function newsletterWordCount(content: OpsNewsletterContent): number {
  const text = [
    content.subject,
    content.intro,
    ...content.sessions.flatMap((session) => [
      session.title,
      session.date_label,
      session.overview,
      ...session.learning_points,
    ]),
    content.closing,
  ].join(' ')
  return text.trim() ? text.trim().split(/\s+/).length : 0
}

/** Dynamic coverage gate: every delivered session appears exactly once. */
export function newsletterSchemaForSessions(sessionIds: string[]) {
  const expected = [...new Set(sessionIds)].sort()
  return NewsletterSchema.superRefine((content, context) => {
    const actual = content.sessions.map((session) => session.session_id).sort()
    if (
      actual.length !== expected.length
      || actual.some((sessionId, index) => sessionId !== expected[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sessions'],
        message: 'Every delivered teaching session must appear exactly once',
      })
    }
  })
}

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
  organizationName: string
  departmentName: string
  weekLabel: string
  content: NewsletterContent
}): string {
  const sessions = input.content.sessions
    .map(
      (session) => `
        <section style="margin:0 0 12px;padding:14px 16px;background:#fff;border:1px solid #1f1f1f;box-shadow:3px 3px 0 #c96f4a;">
          <p style="margin:0 0 3px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#765343;">${escapeHtml(session.date_label)}</p>
          <h3 style="margin:0 0 6px;font-size:16px;line-height:1.25;">${escapeHtml(session.title)}</h3>
          <p style="margin:0 0 7px;color:#34302e;line-height:1.45;">${escapeHtml(session.overview)}</p>
          <ul style="margin:0;padding-left:19px;color:#34302e;line-height:1.4;">
            ${session.learning_points.map((point) => `<li style="margin:2px 0;">${escapeHtml(point)}</li>`).join('')}
          </ul>
        </section>`
    )
    .join('')

  return `
    <div style="margin:0;background:#f6f1e8;padding:22px 12px;color:#1f1f1f;">
      <main style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;max-width:680px;margin:0 auto;">
        <header style="padding:18px 20px;background:#1f1f1f;color:#fff;border-bottom:6px solid #c96f4a;">
          <p style="margin:0 0 5px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#e6c7b8;">${escapeHtml(input.departmentName)} · weekly teaching</p>
          <h2 style="margin:0;font-size:25px;line-height:1.15;">${escapeHtml(input.content.subject)}</h2>
          <p style="margin:8px 0 0;font-size:12px;color:#ddd;">${escapeHtml(input.weekLabel)} · ${escapeHtml(input.organizationName)}</p>
        </header>
        <div style="padding:18px 16px 8px;">
          <p style="margin:0 0 15px;font-size:14px;line-height:1.5;">${escapeHtml(input.content.intro)}</p>
          ${sessions}
          <p style="margin:16px 2px 0;padding:12px 14px;border-left:5px solid #c96f4a;background:#efe2d8;line-height:1.45;">${escapeHtml(input.content.closing)}</p>
        </div>
        <footer style="font-size:11px;color:#68605b;margin-top:8px;border-top:1px solid #c8bdb4;padding:12px 16px;line-height:1.5;">
          This one-page teaching summary was generated from the week&apos;s session information and available uploaded teaching materials, then reviewed by a department moderator before sending.<br />
          <a href="${UNSUBSCRIBE_PLACEHOLDER}" style="color:#68605b;">Unsubscribe from this digest</a>
        </footer>
      </main>
    </div>
  `
}

export function newsletterPreviewText(content: OpsNewsletterContent): string {
  return [
    content.intro,
    ...content.sessions.map((session) =>
      `${session.date_label} — ${session.title}\n${session.overview}\n${session.learning_points.map((point) => `• ${point}`).join('\n')}`
    ),
    content.closing,
  ].join('\n\n')
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
