import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { reminderLinksFor } from '@/lib/session-reminder-links'
import { getMeetingConfig } from '@/lib/meeting/config'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildSessionReminderEmailHtml, sessionEmailTimes } from '@/lib/email-templates'
import { getAppUrl } from '@/lib/app-url'
import { LOCATION_TYPE_LABELS, type LocationType } from '@/lib/types'
import { contactDisplayName, profileDisplayName } from '@/lib/contacts'
import { CRON_SUBREQUEST_BUDGET, CRON_TIME_BUDGET_MS, createRunBudget } from '@/lib/run-budget'
import {
  SESSION_REMINDER_DELIVERY_TYPE,
  pendingReminderRecipients,
  reminderDeliveryDecision,
} from '@/lib/session-delivery-ledger'
import * as sessionsDb from '@/lib/db/sessions'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'
import * as deliveriesDb from '@/lib/db/session-deliveries'

// Estimated subrequests reserved against the run budget. The ledger lookup is
// charged separately so a row the bulk read missed but is already SENT stays
// cheap.
const SESSION_SETUP_COST = 8
const LEDGER_LOOKUP_COST = 2
const RECIPIENT_SEND_COST = 5

interface ReminderRecipient {
  email: string
  userId: string | null
  name: string
  logLabel: string
  /** ACCEPTED invitation code for an external teacher; null for registered members. */
  inviteCode: string | null
}

/**
 * Emails every department member a reminder ~24h before a published session
 * starts. Each recipient has a SESSION_REMINDER row in session_deliveries
 * (related_id = session id), so an interrupted or budget-capped run resumes
 * without re-emailing anyone already SENT. sessions.reminder_sent_at
 * (migration 029) is written only once every recipient is SENT or has used its
 * attempts. Run on a schedule, e.g. hourly:
 * GET /api/cron/session-reminders with Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const sessions = await sessionsDb.listSessionsNeedingReminder()

  if (sessions.length === 0) {
    return NextResponse.json({ message: 'No sessions to remind', processed: 0 })
  }

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const appUrl = getAppUrl()
  const meetingConfig = getMeetingConfig()
  const budget = createRunBudget({
    maxUnits: CRON_SUBREQUEST_BUDGET,
    maxDurationMs: CRON_TIME_BUDGET_MS,
  })

  let processedCount = 0
  let emailsSent = 0
  let deferredSessions = 0
  let deferredRecipients = 0

  for (const [sessionIndex, session] of sessions.entries()) {
    if (!budget.take(SESSION_SETUP_COST)) {
      deferredSessions += sessions.length - sessionIndex
      break
    }

    try {
      // Recipients: department members plus anyone teaching the session who
      // accepted — registered teachers from other departments and external
      // (invitation-only) teachers alike.
      const [memberIds, acceptedTeacherIds, externalTeachers] = await Promise.all([
        departmentsDb.listDepartmentMemberUserIds(session.department_id),
        sessionsDb.listAcceptedSessionTeacherUserIdsAsSystem(session.id),
        teacherInvitationsDb.listAcceptedInvitationRecipientsAsSystem(session.id),
      ])

      const userIds = Array.from(new Set([...memberIds, ...acceptedTeacherIds]))

      if (userIds.length === 0 && externalTeachers.length === 0) {
        await sessionsDb.markSessionReminderSent(session.id)
        processedCount++
        continue
      }

      const [department, profiles, ledger] = await Promise.all([
        departmentsDb.findDepartmentPublic(session.department_id),
        onboardingDb.listProfilesForUsers(userIds),
        deliveriesDb.listSessionDeliveries({
          sessionId: session.id,
          deliveryType: SESSION_REMINDER_DELIVERY_TYPE,
          relatedId: session.id,
        }),
      ])

      // External accepted teachers, deduped (case-insensitively) against
      // registered recipients so nobody gets the reminder twice.
      const registeredEmails = new Set(
        profiles
          .map((p) => p.email?.toLowerCase())
          .filter((e): e is string => !!e)
      )
      const externalRecipients = externalTeachers.filter(
        (t) => t.email && !registeredEmails.has(t.email.toLowerCase())
      )

      const { dateStr, startTime, endTime } = sessionEmailTimes(
        session.date_start,
        session.date_end
      )

      const recipients: ReminderRecipient[] = [
        ...profiles.flatMap((profile) =>
          profile.email
            ? [{
                email: profile.email,
                userId: profile.user_id,
                name: profileDisplayName(profile, profile.email),
                logLabel: profile.user_id,
                inviteCode: null,
              }]
            : []
        ),
        ...externalRecipients.map((teacher) => ({
          email: teacher.email,
          userId: null,
          name: contactDisplayName(teacher),
          logLabel: `external teacher ${teacher.email}`,
          inviteCode: teacher.invite_code,
        })),
      ]
      const pending = pendingReminderRecipients(recipients, ledger)
      let sessionIncomplete = false
      let sessionDeferred = false

      for (const [recipientIndex, recipient] of pending.entries()) {
        if (!budget.take(LEDGER_LOOKUP_COST)) {
          deferredRecipients += pending.length - recipientIndex
          sessionDeferred = true
          break
        }

        let claimedDeliveryId: string | null = null
        try {
          const delivery = await deliveriesDb.getOrCreateSessionDelivery({
            orgId: session.org_id,
            departmentId: session.department_id,
            sessionId: session.id,
            recipientUserId: recipient.userId,
            recipientEmail: recipient.email,
            deliveryType: SESSION_REMINDER_DELIVERY_TYPE,
            relatedId: session.id,
          })
          if (reminderDeliveryDecision(delivery) !== 'SEND') continue
          if (!budget.take(RECIPIENT_SEND_COST)) {
            deferredRecipients += pending.length - recipientIndex
            sessionDeferred = true
            break
          }
          if (!(await deliveriesDb.claimSessionDelivery(delivery.id))) {
            sessionIncomplete = true
            continue
          }
          claimedDeliveryId = delivery.id

          // Members get the session page; external teachers get their RSVP
          // page (they cannot open /sessions/<id>, and token-protected rooms
          // are joined from there).
          const { meetingUrl, sessionUrl } = reminderLinksFor(session, recipient, appUrl, meetingConfig)
          const html = buildSessionReminderEmailHtml({
            recipientName: recipient.name,
            sessionTitle: session.title,
            departmentName: department?.name ?? 'your department',
            dateStr,
            startTime,
            endTime,
            locationLabel:
              LOCATION_TYPE_LABELS[session.location_type as LocationType] ?? session.location_type,
            meetingUrl,
            sessionUrl,
          })

          const sendResult = await mailer.emails.send({
            from: fromAddress,
            to: recipient.email,
            subject: `Reminder: ${session.title} — ${dateStr}`,
            html,
          })
          await deliveriesDb.recordDeliveryAttempt({
            id: delivery.id,
            success: !sendResult.error,
            providerMessageId: sendResult.data?.id,
            error: sendResult.error?.message,
          })
          if (sendResult.error) {
            sessionIncomplete = true
            console.error(
              `Failed to send reminder to ${recipient.logLabel} for session ${session.id}: ${sendResult.error.message}`
            )
          } else {
            emailsSent++
          }
        } catch (err) {
          sessionIncomplete = true
          if (claimedDeliveryId) {
            await deliveriesDb.recordDeliveryAttempt({
              id: claimedDeliveryId,
              success: false,
              error: err instanceof Error ? err.message : 'Reminder delivery failed',
            }).catch((deliveryError) => {
              console.error(
                `Failed to record reminder failure for ${recipient.logLabel} on session ${session.id}:`,
                deliveryError
              )
            })
          }
          console.error(
            `Failed to send reminder to ${recipient.logLabel} for session ${session.id}:`,
            err
          )
        }
      }

      // A failed or contended recipient keeps the session selectable so the
      // next run retries just that row; the window query drops it at start.
      if (sessionDeferred) {
        deferredSessions++
      } else if (!sessionIncomplete) {
        await sessionsDb.markSessionReminderSent(session.id)
        processedCount++
      }
    } catch (err) {
      console.error(`Failed to process reminders for session ${session.id}:`, err)
    }
  }

  return NextResponse.json({
    message: `Processed ${processedCount} of ${sessions.length} sessions`,
    processed: processedCount,
    emailsSent,
    total: sessions.length,
    deferredSessions,
    deferredRecipients,
  })
}
