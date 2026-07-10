import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildRecallEmailHtml } from '@/lib/email-templates'
import { getAppUrl } from '@/lib/app-url'
import { makeRecallToken } from '@/lib/recall'
import { RECALL_VALID_DAYS_AFTER_END } from '@/lib/attendance/compute'
import { formatDateLong } from '@/lib/ops/format'
import { profileDisplayName } from '@/lib/contacts'
import * as recallDb from '@/lib/db/recall'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'

/**
 * Byte Recall delivery. Deterministic sends of MODERATOR-APPROVED question
 * sets (the human gate lives on the session manage Recall tab), same class
 * of core-platform email as session reminders:
 *   - end + 3 days: retention questions to attendees AND catch-up invites
 *     to absent department members (their route to caught-up attendance)
 *   - end + 14 days: one boost nudge to attendees who haven't answered
 *     ("one week left" — the window closes at end + 21 days)
 * Watermark columns on the set make every pass idempotent; sets whose
 * window already closed are watermarked without sending.
 * Run daily: GET /api/cron/recall-send?secret=CRON_SECRET
 */

const DAY_MS = 24 * 60 * 60 * 1000
const FIRST_SEND_DAYS = 3
const BOOST_SEND_DAYS = 14

export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const appUrl = getAppUrl()
  const now = Date.now()

  let sent = 0
  let processed = 0

  async function sendTo(
    userIds: string[],
    sessionId: string,
    sessionTitle: string,
    kind: 'RETENTION' | 'CATCH_UP' | 'BOOST',
    deadlineStr: string
  ) {
    const profiles = await onboardingDb.listProfilesForUsers(userIds)
    for (const profile of profiles) {
      if (!profile.email) continue
      try {
        await mailer.emails.send({
          from: fromAddress,
          to: profile.email,
          subject:
            kind === 'CATCH_UP'
              ? `Missed "${sessionTitle}"? Catch up in 2 minutes`
              : `Quick recall: ${sessionTitle}`,
          html: buildRecallEmailHtml({
            recipientName: profileDisplayName(profile, profile.email),
            sessionTitle,
            kind,
            answerUrl: `${appUrl}/recall/${makeRecallToken(sessionId, profile.user_id)}`,
            deadlineStr,
          }),
        })
        sent++
      } catch (err) {
        console.error(`Failed recall email to ${profile.user_id} for ${sessionId}:`, err)
      }
    }
  }

  // Pass 1: first sends (retention + catch-up) at end + 3 days.
  for (const set of await recallDb.listApprovedSetsNeedingSend('sent_attendees_at')) {
    try {
      const session = await sessionsDb.findSessionById(set.session_id)
      if (!session || session.status !== 'PUBLISHED') {
        await recallDb.markSetSent(set.id, 'sent_attendees_at')
        await recallDb.markSetSent(set.id, 'sent_catchup_at')
        continue
      }
      const end = new Date(session.date_end).getTime()
      if (now < end + FIRST_SEND_DAYS * DAY_MS) continue // not due yet

      // Window already closed (approved too late): watermark without sending.
      if (now > end + RECALL_VALID_DAYS_AFTER_END * DAY_MS) {
        await recallDb.markSetSent(set.id, 'sent_attendees_at')
        await recallDb.markSetSent(set.id, 'sent_catchup_at')
        continue
      }

      const deadlineStr = formatDateLong(
        new Date(end + RECALL_VALID_DAYS_AFTER_END * DAY_MS).toISOString()
      )
      const [attendees, members] = await Promise.all([
        attendanceDb.listAttendeeUserIdsByStatusAsSystem(set.session_id, ['PRESENT', 'LATE']),
        departmentsDb.listDepartmentMemberUserIds(session.department_id),
      ])
      const attendeeSet = new Set(attendees)
      const absentees = members.filter((id) => !attendeeSet.has(id))

      await sendTo(attendees, set.session_id, session.title, 'RETENTION', deadlineStr)
      await sendTo(absentees, set.session_id, session.title, 'CATCH_UP', deadlineStr)
      await recallDb.markSetSent(set.id, 'sent_attendees_at')
      await recallDb.markSetSent(set.id, 'sent_catchup_at')
      processed++
    } catch (err) {
      console.error(`recall-send first pass failed for set ${set.id}:`, err)
    }
  }

  // Pass 2: boost nudge at end + 14 days to attendees who haven't answered.
  for (const set of await recallDb.listApprovedSetsNeedingSend('sent_boost_at')) {
    try {
      if (!set.sent_attendees_at) continue // first send hasn't happened yet
      const session = await sessionsDb.findSessionById(set.session_id)
      if (!session || session.status !== 'PUBLISHED') {
        await recallDb.markSetSent(set.id, 'sent_boost_at')
        continue
      }
      const end = new Date(session.date_end).getTime()
      if (now < end + BOOST_SEND_DAYS * DAY_MS) continue
      if (now > end + RECALL_VALID_DAYS_AFTER_END * DAY_MS) {
        await recallDb.markSetSent(set.id, 'sent_boost_at')
        continue
      }

      const deadlineStr = formatDateLong(
        new Date(end + RECALL_VALID_DAYS_AFTER_END * DAY_MS).toISOString()
      )
      const [attendees, answered] = await Promise.all([
        attendanceDb.listAttendeeUserIdsByStatusAsSystem(set.session_id, ['PRESENT', 'LATE']),
        recallDb.listAnsweredUserIds(set.session_id),
      ])
      const pending = attendees.filter((id) => !answered.has(id))

      await sendTo(pending, set.session_id, session.title, 'BOOST', deadlineStr)
      await recallDb.markSetSent(set.id, 'sent_boost_at')
      processed++
    } catch (err) {
      console.error(`recall-send boost pass failed for set ${set.id}:`, err)
    }
  }

  return NextResponse.json({ message: `${processed} set(s) processed, ${sent} email(s)`, processed, sent })
}
