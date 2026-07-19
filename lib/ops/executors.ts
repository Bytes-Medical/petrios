import { getEmailClient, getFromAddress } from '@/lib/email'
import { getAppUrl } from '@/lib/app-url'
import type { OpsPendingAction } from '@/lib/types'
import * as opsDb from '@/lib/db/ops'
import * as departmentsDb from '@/lib/db/departments'
import { makeUnsubToken, UNSUBSCRIBE_PLACEHOLDER } from './newsletter'

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

async function executeNewsletterIssue(action: OpsPendingAction): Promise<void> {
  const payload = action.payload as { issueId?: string; contentRevision?: number }
  const issueId = payload.issueId
  if (!issueId) throw new Error('Newsletter action payload is missing issueId')

  const issue = await opsDb.findNewsletterIssueById(issueId)
  if (!issue) throw new Error('Newsletter issue not found')
  if (issue.org_id !== action.org_id || issue.department_id !== action.department_id) {
    throw new Error('Newsletter action scope does not match its issue')
  }
  if (issue.status === 'sent') return // already delivered (double-execution guard)
  if (!issue.department_id || !issue.content) {
    throw new Error('Legacy organization-wide newsletters cannot use department delivery')
  }
  if (payload.contentRevision !== issue.content_revision) {
    throw new Error('The newsletter changed after review; review the current revision before sending')
  }

  await opsDb.updateNewsletterIssue(issue.id, { status: 'approved' })

  const [members, optouts] = await Promise.all([
    departmentsDb.listDepartmentMembersWithProfiles(action.org_id, issue.department_id),
    opsDb.listNewsletterOptoutUserIds(action.org_id),
  ])
  const recipients = members.filter((member) => !optouts.has(member.user_id))
  const missingEmail = recipients.filter((member) => !member.email.trim())
  if (missingEmail.length > 0) {
    await opsDb.updateNewsletterIssue(issue.id, { status: 'failed' })
    throw new Error(`${missingEmail.length} department member(s) do not have a deliverable email address`)
  }
  await opsDb.seedNewsletterDeliveries({
    issue,
    recipients: recipients.map((member) => ({ userId: member.user_id, email: member.email })),
  })

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const appUrl = getAppUrl()

  const deliveries = await opsDb.listNewsletterDeliveries(issue.id)
  for (const delivery of deliveries) {
    if (delivery.status === 'SENT') continue
    if (delivery.content_revision !== issue.content_revision) {
      throw new Error('A newsletter delivery belongs to an obsolete content revision')
    }
    const claimed = await opsDb.claimNewsletterDelivery(delivery.id)
    if (!claimed) continue
    try {
      const unsubUrl = `${appUrl}/ops/unsubscribe/${makeUnsubToken(action.org_id, delivery.recipient_user_id)}`
      const html = issue.html.split(UNSUBSCRIBE_PLACEHOLDER).join(unsubUrl)
      const result = await mailer.emails.send({
        from: fromAddress,
        to: delivery.recipient_email,
        subject: issue.subject,
        html,
      })
      if (result.error) throw new Error(result.error.message)
      await opsDb.finishNewsletterDelivery({
        id: delivery.id,
        success: true,
        providerMessageId: result.data?.id,
      })
    } catch (err) {
      await opsDb.finishNewsletterDelivery({
        id: delivery.id,
        success: false,
        error: err instanceof Error ? err.message : 'Newsletter delivery failed',
      }).catch(() => undefined)
      console.error(`Failed to send newsletter to ${delivery.recipient_user_id}:`, err)
    }
  }

  const final = await opsDb.listNewsletterDeliveries(issue.id)
  const sent = final.filter((delivery) => delivery.status === 'SENT').length
  const unfinished = final.filter((delivery) => delivery.status !== 'SENT').length
  if (unfinished > 0) {
    await opsDb.updateNewsletterIssue(issue.id, { status: 'failed', sentCount: sent })
    throw new Error(`${unfinished} newsletter delivery(s) failed or remain unfinished; successful members will not be emailed again`)
  }

  await opsDb.updateNewsletterIssue(issue.id, { status: 'sent', sentCount: sent })
}
