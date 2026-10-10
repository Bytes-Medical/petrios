import { getEmailClient, getFromAddress } from '@/lib/email'
import { getAppUrl } from '@/lib/app-url'
import type { OpsNewsletterIssue, OpsPendingAction } from '@/lib/types'
import * as opsDb from '@/lib/db/ops'
import * as departmentsDb from '@/lib/db/departments'
import { appTimeZone } from '@/lib/datetime'
import { createRunBudget } from '@/lib/run-budget'
import {
  buildNewsletterText,
  createSendPacer,
  makeUnsubToken,
  newsletterIdempotencyKey,
  newsletterUnsubscribeUrls,
  NewsletterUserError,
  NEWSLETTER_EXECUTION_LEASE_MS,
  NEWSLETTER_SEND_INTERVAL_MS,
  NEWSLETTER_SEND_SUBREQUEST_BUDGET,
  NEWSLETTER_SEND_TIME_BUDGET_MS,
  NEWSLETTER_SUBREQUESTS_PER_RECIPIENT,
  newsletterRenderInput,
  planNewsletterRecipients,
  sanitizeNewsletterDeliveryError,
  staleNewsletterDeliveryIds,
  tallyNewsletterDeliveries,
  UNSUBSCRIBE_PLACEHOLDER,
} from './newsletter'

/**
 * Executors: the ONLY code paths that send ops-originated email. They run
 * exclusively on actions a human just approved (app/actions/ops.ts claims
 * the row with a compare-and-set before calling here). If you are adding an
 * outbound capability to the ops layer, it must become a new action type
 * here — never a direct emails.send anywhere else in lib/ops.
 */
export async function executeAction(action: OpsPendingAction): Promise<void> {
  switch (action.type) {
    case 'SPEAKER_CHASE_EMAIL':
      return executeChaseEmail(action)
    case 'THANK_YOU_EMAIL':
    case 'CUSTOM_EMAIL':
      return executeSimpleEmail(action)
    case 'NEWSLETTER_ISSUE':
      return executeNewsletterIssue(action)
    default:
      throw new Error(`Unknown ops action type: ${(action as { type: string }).type}`)
  }
}

interface EmailPayload {
  email?: string
  subject?: string
  html?: string
  sessionId?: string
  targetUserId?: string
  targetInvitationId?: string
}

async function sendPayloadEmail(action: OpsPendingAction): Promise<EmailPayload> {
  const payload = action.payload as EmailPayload
  if (!payload.email || !payload.subject || !payload.html) {
    throw new Error('Email action payload is missing email/subject/html')
  }

  const mailer = getEmailClient()
  const { error } = await mailer.emails.send({
    from: getFromAddress(),
    to: payload.email,
    subject: payload.subject,
    html: payload.html,
  })
  if (error) throw new Error(`Failed to send email: ${error.message}`)
  return payload
}

async function executeChaseEmail(action: OpsPendingAction): Promise<void> {
  const payload = await sendPayloadEmail(action)
  if (payload.sessionId) {
    await opsDb.recordChaseSent({
      orgId: action.org_id,
      sessionId: payload.sessionId,
      targetUserId: payload.targetUserId ?? null,
      targetInvitationId: payload.targetInvitationId ?? null,
      targetEmail: payload.email!,
    })
  }
}

async function executeSimpleEmail(action: OpsPendingAction): Promise<void> {
  await sendPayloadEmail(action)
}

/** Injected clock/sleep so delivery pacing and budgets are testable. */
export interface NewsletterExecutionOptions {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const RATE_LIMIT_RETRIES = 2
const MAX_RATE_LIMIT_WAIT_MS = 5_000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Fan one exact reviewed revision out to the CURRENT audience through the
 * per-recipient ledger. Only `executeAction` (after a human approval) and its
 * tests call this.
 */
export async function executeNewsletterIssue(
  action: OpsPendingAction,
  options: NewsletterExecutionOptions = {}
): Promise<void> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep
  const payload = action.payload as { issueId?: string; contentRevision?: number }
  const issueId = payload.issueId
  if (!issueId) throw new Error('Newsletter action payload is missing issueId')

  const current = await opsDb.findNewsletterIssueById(issueId)
  if (!current) throw new NewsletterUserError('Newsletter issue not found')
  if (current.org_id !== action.org_id || current.department_id !== action.department_id) {
    throw new Error('Newsletter action scope does not match its issue')
  }
  if (current.status === 'sent') return // already delivered (double-execution guard)
  if (!current.department_id || !current.content) {
    throw new NewsletterUserError('Legacy organization-wide newsletters cannot use department delivery')
  }
  if (typeof payload.contentRevision !== 'number' || payload.contentRevision !== current.content_revision) {
    throw new NewsletterUserError('The newsletter changed after review; review the current revision before sending')
  }

  // Compare-and-set into `approved` for exactly the reviewed revision, then
  // send from the row that CAS returned — never from the earlier read, which a
  // concurrent save or regenerate may already have replaced.
  const issue = await opsDb.beginNewsletterExecution({
    id: current.id,
    orgId: action.org_id,
    departmentId: current.department_id,
    contentRevision: payload.contentRevision,
    staleBefore: new Date(now() - NEWSLETTER_EXECUTION_LEASE_MS).toISOString(),
    pendingActionId: action.id,
  })
  if (!issue || !issue.content) {
    throw new NewsletterUserError(
      'This newsletter is already being delivered or changed after review; refresh and try again in a few minutes'
    )
  }

  try {
    await deliverNewsletterIssue(action, issue, { now, sleep })
  } catch (error) {
    // Never leave the issue holding the lease after a failure: record the
    // real success count from the ledger (which also keeps editing locked
    // when any member already received it).
    await finaliseFailedIssue(issue.id).catch((finaliseError) => {
      console.error('Failed to record newsletter delivery failure:', finaliseError)
    })
    throw error
  }
}

async function finaliseFailedIssue(issueId: string): Promise<void> {
  const { sent } = tallyNewsletterDeliveries(await opsDb.listNewsletterDeliveries(issueId))
  await opsDb.updateNewsletterIssue(issueId, { status: 'failed', sentCount: sent })
}

/**
 * The text/plain part, rendered once per execution purely from the stored
 * issue: the exact reviewed content and its render snapshot, including the
 * organisation and department names taken at generation (never re-read, so
 * it always matches the stored HTML and a retry sends identical bytes). A
 * legacy issue without a snapshot keeps its original HTML-only delivery.
 */
function newsletterTextPart(issue: OpsNewsletterIssue, appUrl: string): string | null {
  if (!issue.content?.render || !issue.department_id) return null
  return buildNewsletterText(newsletterRenderInput(
    { ...issue, content: issue.content },
    { appUrl, timeZone: appTimeZone() }
  ))
}

async function deliverNewsletterIssue(
  action: OpsPendingAction,
  issue: OpsNewsletterIssue,
  deps: Required<NewsletterExecutionOptions>
): Promise<void> {
  const departmentId = issue.department_id!
  // Rendered before any ledger write, so a snapshot problem fails the issue
  // without seeding deliveries.
  const appUrl = getAppUrl()
  const textPart = newsletterTextPart(issue, appUrl)
  const members = await departmentsDb.listDepartmentMembersWithProfiles(action.org_id, departmentId)
  const optouts = await opsDb.listNewsletterOptoutUserIds(
    action.org_id,
    members.map((member) => member.user_id)
  )
  const { recipients, missingEmail } = planNewsletterRecipients(members, optouts)
  if (missingEmail > 0) {
    throw new NewsletterUserError(
      `${missingEmail} department member(s) do not have a deliverable email address; fix their profiles and try again`
    )
  }
  if (recipients.length === 0) {
    throw new NewsletterUserError(
      'No current department member is eligible to receive this newsletter (members may have unsubscribed); nothing was emailed'
    )
  }

  // Audience is evaluated at execution, including on retry: unsent rows for
  // members who left, opted out, or changed address are removed before any
  // send, and current rows are (re-)seeded.
  const existing = await opsDb.listNewsletterDeliveries(issue.id)
  await opsDb.deleteNewsletterDeliveries(issue.id, staleNewsletterDeliveryIds(existing, recipients))
  await opsDb.seedNewsletterDeliveries({ issue, recipients })

  const eligible = new Map(recipients.map((recipient) => [recipient.userId, recipient.email]))
  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const budget = createRunBudget({
    maxUnits: NEWSLETTER_SEND_SUBREQUEST_BUDGET,
    maxDurationMs: NEWSLETTER_SEND_TIME_BUDGET_MS,
    now: deps.now,
  })
  const pace = createSendPacer(NEWSLETTER_SEND_INTERVAL_MS, deps)

  const deliveries = await opsDb.listNewsletterDeliveries(issue.id)
  for (const delivery of deliveries) {
    if (delivery.status === 'SENT') continue
    if (delivery.content_revision !== issue.content_revision) {
      throw new Error('A newsletter delivery belongs to an obsolete content revision')
    }
    if (eligible.get(delivery.recipient_user_id) !== delivery.recipient_email) continue
    if (!budget.take(NEWSLETTER_SUBREQUESTS_PER_RECIPIENT)) break
    const urls = newsletterUnsubscribeUrls(appUrl, makeUnsubToken(action.org_id, delivery.recipient_user_id))
    const html = issue.html.split(UNSUBSCRIBE_PLACEHOLDER).join(urls.page)
    const text = textPart?.split(UNSUBSCRIBE_PLACEHOLDER).join(urls.page)
    const claimed = await opsDb.claimNewsletterDelivery(delivery.id)
    if (!claimed) continue // another execution holds this row's lease

    let result: Awaited<ReturnType<typeof mailer.emails.send>> | null = null
    for (let attempt = 0; ; attempt += 1) {
      await pace()
      try {
        result = await mailer.emails.send({
          from: fromAddress,
          to: claimed.recipient_email,
          subject: issue.subject,
          html,
          ...(text ? { text } : {}),
          idempotencyKey: newsletterIdempotencyKey(claimed),
          headers: {
            'List-Unsubscribe': `<${urls.oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        })
      } catch (err) {
        result = { data: null, error: { message: err instanceof Error ? err.message : 'Newsletter delivery failed' } }
      }
      const rateLimited = result.error?.statusCode === 429
      if (!rateLimited || attempt >= RATE_LIMIT_RETRIES || !budget.take(1)) break
      const waitMs = Math.min(MAX_RATE_LIMIT_WAIT_MS, (result.error?.retryAfterSeconds ?? 1) * 1000)
      await deps.sleep(waitMs)
    }

    if (result?.error) {
      console.error(`Failed to send newsletter to ${delivery.recipient_user_id}:`, result.error.message)
      await opsDb.finishNewsletterDelivery({
        id: claimed.id,
        attemptCount: claimed.attempt_count,
        success: false,
        error: sanitizeNewsletterDeliveryError(result.error.message),
      }).catch((err) => console.error('Failed to record newsletter delivery failure:', err))
      continue
    }

    // The provider accepted the email. A failed ledger write must never
    // downgrade it to FAILED (Retry would email the member again): try the
    // SENT write twice, then leave the row SENDING under its lease. A later
    // resend carries the same idempotency key, which the provider dedupes.
    const sentRecord = {
      id: claimed.id,
      attemptCount: claimed.attempt_count,
      success: true,
      providerMessageId: result?.data?.id ?? null,
    }
    try {
      await opsDb.finishNewsletterDelivery(sentRecord)
    } catch {
      await opsDb.finishNewsletterDelivery(sentRecord).catch((err) => {
        console.error(`Newsletter to ${delivery.recipient_user_id} was accepted but could not be recorded as SENT:`, err)
      })
    }
  }

  const { sent, unfinished } = tallyNewsletterDeliveries(await opsDb.listNewsletterDeliveries(issue.id))
  if (unfinished > 0) {
    await opsDb.updateNewsletterIssue(issue.id, { status: 'failed', sentCount: sent })
    throw new NewsletterUserError(
      budget.exhausted
        ? `Delivered to ${sent} member(s); ${unfinished} remain because one request sends a bounded batch. Choose "Retry unfinished delivery" to continue — members already emailed will not be emailed again.`
        : `${unfinished} newsletter delivery(s) failed or remain unfinished; members already emailed will not be emailed again. Choose "Retry unfinished delivery" to try the rest.`
    )
  }

  await opsDb.updateNewsletterIssue(issue.id, { status: 'sent', sentCount: sent })
}
