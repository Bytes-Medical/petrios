import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type {
  OpsNewsletterContent,
  OpsNewsletterDelivery,
  OpsNewsletterIssue,
} from '@/lib/types'

/**
 * Department weekly teaching newsletter: pure helpers (week windowing,
 * one-page content validation, HTML rendering, unsubscribe tokens, and the
 * delivery-ledger decisions the executor makes). A moderator explicitly
 * starts generation and reviews the exact draft before the NEWSLETTER_ISSUE
 * executor may send it.
 */

/**
 * An expected, moderator-actionable newsletter outcome (empty week, stale tab,
 * partial delivery, ...). Server actions return its message as
 * `{ ok: false, message }` because Next masks thrown Server Action errors in
 * production (spec 07); every other error is unexpected and still thrown.
 */
export class NewsletterUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewsletterUserError'
  }
}

export interface WeekWindow {
  /** Monday 00:00 UTC of the selected week. */
  weekStart: Date
  /** Exclusive end: the following Monday 00:00 UTC. */
  weekEnd: Date
  /**
   * Exclusive upper bound for a session's `date_end`: the earlier of weekEnd
   * and the moment the window was computed, so a mid-week draft never covers
   * teaching that has not ended yet.
   */
  coverEnd: Date
  /** YYYY-MM-DD of weekStart — the ops_newsletter_issues natural key. */
  weekStartKey: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The most recent complete Mon–Sun week strictly before `now` (UTC). */
export function newsletterWeekWindow(now: Date): WeekWindow {
  const day = now.getUTCDay() // 0 = Sunday ... 6 = Saturday
  const daysSinceMonday = (day + 6) % 7
  const thisMonday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
  const weekEnd = new Date(thisMonday)
  const weekStart = new Date(thisMonday - 7 * DAY_MS)
  return {
    weekStart,
    weekEnd,
    coverEnd: weekEnd,
    weekStartKey: weekStart.toISOString().slice(0, 10),
  }
}

/** Validate an explicitly selected Monday-Sunday UTC week that has started.
 *  Mid-week drafts are deliberate: `coverEnd` caps the window at `now`, so
 *  generation reads only sessions that have already ENDED, and a draft is
 *  regenerable until it is sent, so an early draft covers the week so far. */
export function newsletterWindowFromWeekStart(
  weekStartKey: string,
  now = new Date()
): WeekWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartKey)) {
    throw new NewsletterUserError('Choose a valid week start date')
  }
  const weekStart = new Date(`${weekStartKey}T00:00:00.000Z`)
  if (Number.isNaN(weekStart.getTime()) || weekStart.toISOString().slice(0, 10) !== weekStartKey) {
    throw new NewsletterUserError('Choose a valid week start date')
  }
  if (weekStart.getUTCDay() !== 1) throw new NewsletterUserError('The newsletter week must start on a Monday')
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS)
  if (weekStart.getTime() > now.getTime()) {
    throw new NewsletterUserError("That week hasn't started yet — pick the current or a past week")
  }
  if (weekStart.getTime() < now.getTime() - 366 * DAY_MS) {
    throw new NewsletterUserError('Newsletter generation is limited to the last year')
  }
  const coverEnd = new Date(Math.min(weekEnd.getTime(), now.getTime()))
  return { weekStart, weekEnd, coverEnd, weekStartKey }
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
// Unsubscribe tokens: HMAC-SHA256-signed orgId+userId so links work without a
// login but cannot be forged or enumerated. The secret is the server-only
// service-role key, so rotating that key invalidates links already sent.
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

/** Public unsubscribe URLs for one recipient: a confirmation page (GET has no
 *  side effect) and the RFC 8058 one-click POST target for mailbox providers. */
export function newsletterUnsubscribeUrls(appUrl: string, token: string): {
  page: string
  oneClick: string
} {
  const page = `${appUrl.replace(/\/+$/, '')}/ops/unsubscribe/${token}`
  return { page, oneClick: `${page}/one-click` }
}

// ---------------------------------------------------------------------------
// Edit snapshot binding
// ---------------------------------------------------------------------------

/**
 * Bind a moderator's edit to the generated snapshot: session identity, title
 * and date label always come from the stored issue, even if a crafted client
 * submits other values, and coverage/word limits are revalidated.
 */
export function normalizeNewsletterEdit(
  snapshot: Pick<OpsNewsletterIssue, 'source_session_ids'> & { content: OpsNewsletterContent },
  submitted: OpsNewsletterContent
): NewsletterContent {
  const trustedSections = new Map(
    snapshot.content.sessions.map((section) => [section.session_id, section])
  )
  const normalized: OpsNewsletterContent = {
    ...submitted,
    sessions: (submitted.sessions ?? []).map((section) => {
      const trusted = trustedSections.get(section.session_id)
      return trusted
        ? { ...section, title: trusted.title, date_label: trusted.date_label }
        : section
    }),
  }
  const parsed = newsletterSchemaForSessions(snapshot.source_session_ids).safeParse(normalized)
  if (!parsed.success) {
    throw new NewsletterUserError(parsed.error.issues[0]?.message ?? 'Newsletter content is invalid')
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Issue lifecycle and delivery-ledger decisions (pure; the executor and the
// server actions apply them)
// ---------------------------------------------------------------------------

/** An execution holds the issue in `approved` for at most this long; it matches
 *  the per-recipient SENDING lease in claim_ops_newsletter_delivery_v1. */
export const NEWSLETTER_EXECUTION_LEASE_MS = 10 * 60 * 1000
/** One request stops starting sends well inside the execution lease, so two
 *  executions never overlap; the remainder continues on "Retry unfinished". */
export const NEWSLETTER_SEND_TIME_BUDGET_MS = 4 * 60 * 1000
/** Estimated subrequests per request (claim + send + finish per member), well
 *  under the Workers per-request subrequest limit. */
export const NEWSLETTER_SEND_SUBREQUEST_BUDGET = 3_000
export const NEWSLETTER_SUBREQUESTS_PER_RECIPIENT = 3
/** Minimum spacing between provider sends (Resend's default limit is 2/s,
 *  shared with every other transactional email). */
export const NEWSLETTER_SEND_INTERVAL_MS = 500

export interface NewsletterIssueControls {
  /** Narrative may be edited, saved, and approved for a first send. */
  editable: boolean
  /** The week may be generated again over this issue. */
  regenerable: boolean
  /** An execution started under the current lease; Retry must wait. */
  inProgress: boolean
  /** Unfinished delivery of the reviewed revision may be resumed. */
  canRetry: boolean
}

/**
 * Decide what a moderator may do with an issue. `deliveryLocked` is true when
 * the per-recipient ledger holds any SENT or SENDING row: the denormalised
 * `sent_count` is only written when an execution finishes, so a cut-off run
 * must still lock editing (one issue never delivers different content to
 * different members).
 */
export function newsletterIssueControls(
  issue: Pick<OpsNewsletterIssue, 'status' | 'sent_count' | 'updated_at'> & {
    content: OpsNewsletterContent | null
  },
  deliveryLocked: boolean,
  now: Date
): NewsletterIssueControls {
  const updatedAt = Date.parse(issue.updated_at)
  const inProgress = issue.status === 'approved'
    && Number.isFinite(updatedAt)
    && now.getTime() - updatedAt < NEWSLETTER_EXECUTION_LEASE_MS
  const untouched = (issue.status === 'draft' || issue.status === 'failed')
    && issue.sent_count === 0
    && !deliveryLocked
  return {
    editable: untouched && issue.content !== null,
    regenerable: untouched,
    inProgress,
    canRetry: issue.content !== null
      && !untouched
      && (issue.status === 'failed' || (issue.status === 'approved' && !inProgress)),
  }
}

export interface NewsletterMember {
  user_id: string
  email: string
}

export interface NewsletterRecipient {
  userId: string
  email: string
}

/**
 * The audience at execution time: current department members minus
 * organization-level opt-outs, with normalized addresses. A member without an
 * address is counted (the execution fails closed instead of dropping them);
 * a second account sharing an address is not emailed twice.
 */
export function planNewsletterRecipients(
  members: NewsletterMember[],
  optouts: ReadonlySet<string>
): { recipients: NewsletterRecipient[]; missingEmail: number } {
  const recipients: NewsletterRecipient[] = []
  const seenUsers = new Set<string>()
  const seenEmails = new Set<string>()
  let missingEmail = 0
  for (const member of members) {
    if (optouts.has(member.user_id) || seenUsers.has(member.user_id)) continue
    seenUsers.add(member.user_id)
    const email = (member.email ?? '').trim().toLowerCase()
    if (!email) {
      missingEmail += 1
      continue
    }
    if (seenEmails.has(email)) continue
    seenEmails.add(email)
    recipients.push({ userId: member.user_id, email })
  }
  return { recipients, missingEmail }
}

/**
 * Unsent ledger rows that no longer match the current audience: the member
 * left the department, opted out, or changed address since the row was
 * seeded. They are removed (and a current row re-seeded) before any send, so
 * a retry never emails someone the audience rule now excludes.
 */
export function staleNewsletterDeliveryIds(
  deliveries: Pick<OpsNewsletterDelivery, 'id' | 'status' | 'recipient_user_id' | 'recipient_email'>[],
  recipients: NewsletterRecipient[]
): string[] {
  const current = new Map(recipients.map((recipient) => [recipient.userId, recipient.email]))
  return deliveries
    .filter((delivery) =>
      delivery.status !== 'SENT'
      && current.get(delivery.recipient_user_id) !== delivery.recipient_email
    )
    .map((delivery) => delivery.id)
}

export function tallyNewsletterDeliveries(
  deliveries: Pick<OpsNewsletterDelivery, 'status'>[]
): { sent: number; unfinished: number; locked: boolean } {
  const sent = deliveries.filter((delivery) => delivery.status === 'SENT').length
  return {
    sent,
    unfinished: deliveries.length - sent,
    locked: deliveries.some((delivery) => delivery.status === 'SENT' || delivery.status === 'SENDING'),
  }
}

/** Stable per-recipient/revision key: the provider deduplicates a resend of
 *  the same email (Resend keeps keys for 24 hours). */
export function newsletterIdempotencyKey(
  delivery: Pick<OpsNewsletterDelivery, 'id' | 'content_revision'>
): string {
  return `ops-newsletter/${delivery.id}/${delivery.content_revision}`
}

/** Persistable delivery error: no recipient addresses, bounded length. */
export function sanitizeNewsletterDeliveryError(message: string | null | undefined): string {
  const cleaned = (message ?? '')
    .replace(/[^\s<>"'(),;:[\]]+@[^\s<>"'(),;:[\]]+/g, '[address]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
  return cleaned || 'Newsletter delivery failed'
}

/** Spaces sends at least `intervalMs` apart. */
export function createSendPacer(
  intervalMs: number,
  deps: { now: () => number; sleep: (ms: number) => Promise<void> }
): () => Promise<void> {
  let nextAt = 0
  return async () => {
    const now = deps.now()
    if (now < nextAt) await deps.sleep(nextAt - now)
    nextAt = Math.max(now, nextAt) + intervalMs
  }
}
