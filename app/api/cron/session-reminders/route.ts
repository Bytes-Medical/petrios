import { NextRequest, NextResponse } from 'next/server'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildSessionReminderEmailHtml } from '@/lib/email-templates'
import { getAppUrl } from '@/lib/app-url'
import { LOCATION_TYPE_LABELS, type LocationType } from '@/lib/types'
import { contactDisplayName, profileDisplayName } from '@/lib/contacts'
import * as sessionsDb from '@/lib/db/sessions'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'

/**
 * Emails every department member a reminder ~24h before a published session
 * starts. Idempotent via sessions.reminder_sent_at (migration 029). Run on a
 * schedule, e.g. hourly: GET /api/cron/session-reminders?secret=CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessions = await sessionsDb.listSessionsNeedingReminder()

  if (sessions.length === 0) {
    return NextResponse.json({ message: 'No sessions to remind', processed: 0 })
  }

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const appUrl = getAppUrl()

  let processedCount = 0
  let emailsSent = 0

  for (const session of sessions) {
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

      const [department, profiles] = await Promise.all([
        departmentsDb.findDepartmentPublic(session.department_id),
        onboardingDb.listProfilesForUsers(userIds),
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

      const startDate = new Date(session.date_start)
      const endDate = new Date(session.date_end)
      const dateStr = startDate.toLocaleDateString('en-GB', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      const startTime = startDate.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })
      const endTime = endDate.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      })

      for (const profile of profiles) {
        if (!profile.email) continue
        try {
          const recipientName = profileDisplayName(profile, profile.email)

          const html = buildSessionReminderEmailHtml({
            recipientName,
            sessionTitle: session.title,
            departmentName: department?.name ?? 'your department',
            dateStr,
            startTime,
            endTime,
            locationLabel:
              LOCATION_TYPE_LABELS[session.location_type as LocationType] ?? session.location_type,
            meetingUrl: session.teams_meeting_url,
            sessionUrl: `${appUrl}/sessions/${session.id}`,
          })

          await mailer.emails.send({
            from: fromAddress,
            to: profile.email,
            subject: `Reminder: ${session.title} — ${dateStr}`,
            html,
          })
          emailsSent++
        } catch (err) {
          console.error(
            `Failed to send reminder to ${profile.user_id} for session ${session.id}:`,
            err
          )
        }
      }

      for (const teacher of externalRecipients) {
        try {
          const recipientName = contactDisplayName(teacher)

          const html = buildSessionReminderEmailHtml({
            recipientName,
            sessionTitle: session.title,
            departmentName: department?.name ?? 'your department',
            dateStr,
            startTime,
            endTime,
            locationLabel:
              LOCATION_TYPE_LABELS[session.location_type as LocationType] ?? session.location_type,
            meetingUrl: session.teams_meeting_url,
            sessionUrl: `${appUrl}/sessions/${session.id}`,
          })

          await mailer.emails.send({
            from: fromAddress,
            to: teacher.email,
            subject: `Reminder: ${session.title} — ${dateStr}`,
            html,
          })
          emailsSent++
        } catch (err) {
          console.error(
            `Failed to send reminder to external teacher ${teacher.email} for session ${session.id}:`,
            err
          )
        }
      }

      await sessionsDb.markSessionReminderSent(session.id)
      processedCount++
    } catch (err) {
      console.error(`Failed to process reminders for session ${session.id}:`, err)
    }
  }

  return NextResponse.json({
    message: `Processed ${processedCount} of ${sessions.length} sessions`,
    processed: processedCount,
    emailsSent,
    total: sessions.length,
  })
}
