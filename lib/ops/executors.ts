import { getEmailClient, getFromAddress } from '@/lib/email'
import { getAppUrl } from '@/lib/app-url'
import type { OpsPendingAction } from '@/lib/types'
import * as opsDb from '@/lib/db/ops'
import * as onboardingDb from '@/lib/db/onboarding'
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
  const issueId = (action.payload as { issueId?: string }).issueId
  if (!issueId) throw new Error('Newsletter action payload is missing issueId')

  const issue = await opsDb.findNewsletterIssueById(issueId)
  if (!issue) throw new Error('Newsletter issue not found')
  if (issue.status === 'sent') return // already delivered (double-execution guard)

  await opsDb.updateNewsletterIssue(issue.id, { status: 'approved' })

  const [members, optouts] = await Promise.all([
    onboardingDb.listOrganizationMembers(action.org_id),
    opsDb.listNewsletterOptoutUserIds(action.org_id),
  ])
  const recipientIds = members.map((m) => m.user_id).filter((id) => !optouts.has(id))
  const profiles = await onboardingDb.listProfilesForUsers(recipientIds)

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const appUrl = getAppUrl()

  let sent = 0
  for (const profile of profiles) {
    if (!profile.email) continue
    try {
      const unsubUrl = `${appUrl}/ops/unsubscribe/${makeUnsubToken(action.org_id, profile.user_id)}`
      const html = issue.html.split(UNSUBSCRIBE_PLACEHOLDER).join(unsubUrl)
      const { error } = await mailer.emails.send({
        from: fromAddress,
        to: profile.email,
        subject: issue.subject,
        html,
      })
      if (error) throw new Error(error.message)
      sent++
    } catch (err) {
      console.error(`Failed to send newsletter to ${profile.user_id}:`, err)
    }
  }

  if (sent === 0 && profiles.length > 0) {
    await opsDb.updateNewsletterIssue(issue.id, { status: 'failed', sentCount: 0 })
    throw new Error(`Newsletter delivery failed for all ${profiles.length} recipients`)
  }

  await opsDb.updateNewsletterIssue(issue.id, { status: 'sent', sentCount: sent })
}
