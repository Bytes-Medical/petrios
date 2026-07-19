import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildRecallEmailHtml } from '@/lib/email-templates'
import { getAppUrl } from '@/lib/app-url'
import { makeRecallToken } from '@/lib/recall'
import { formatDateLong } from '@/lib/ops/format'
import { profileDisplayName } from '@/lib/contacts'
import * as recallDb from '@/lib/db/recall'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'
import * as audioRecapsDb from '@/lib/db/audio-recaps'
import * as deliveriesDb from '@/lib/db/session-deliveries'

/**
 * Delivers the moderator-published Audio Recap catch-up package to finalized
 * registered absentees. Per-recipient delivery rows make retries idempotent;
 * the set watermark closes only after every eligible recipient is SENT.
 */
export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const appUrl = getAppUrl()
  let sent = 0
  let processed = 0

  for (const set of await recallDb.listApprovedSetsNeedingSend('sent_catchup_at')) {
    try {
      const [session, recap] = await Promise.all([
        sessionsDb.findPublishedSessionWithFeedbackFields(set.session_id),
        audioRecapsDb.findRecapForSession(set.session_id),
      ])
      if (
        !session ||
        session.attendance_phase !== 'FINALIZED' ||
        (session.attendance_policy_version ?? 1) < 2 ||
        set.questions.length !== 5 ||
        !set.script_digest ||
        !set.catchup_closes_at ||
        !recap ||
        recap.status !== 'approved' ||
        !recap.audio_bytes ||
        recap.script_digest !== set.script_digest
      ) {
        // This is a fixable governance/state mismatch, so leave the watermark
        // open rather than silently abandoning the eligible audience.
        continue
      }
      if (Date.now() > new Date(set.catchup_closes_at).getTime()) {
        await recallDb.markSetSent(set.id, 'sent_catchup_at')
        await recallDb.markSetSent(set.id, 'sent_attendees_at')
        await recallDb.markSetSent(set.id, 'sent_boost_at')
        processed++
        continue
      }

      const [absentIds, expectedIds, teacherIds] = await Promise.all([
        attendanceDb.listAttendeeUserIdsByStatusAsSystem(set.session_id, ['ABSENT']),
        attendanceDb.listExpectedAttendeeUserIdsAsSystem(set.session_id),
        certificatesDb.listAcceptedRegisteredTeacherIdsAsSystem(set.session_id),
      ])
      const teachers = new Set(teacherIds)
      const expected = new Set(expectedIds)
      const eligibleIds = absentIds.filter(
        (userId) => expected.has(userId) && !teachers.has(userId)
      )
      const profiles = await onboardingDb.listProfilesForUsers(eligibleIds)
      const profileByUserId = new Map(profiles.map((profile) => [profile.user_id, profile]))
      const deadlineStr = formatDateLong(set.catchup_closes_at)
      let hadFailure = false

      for (const userId of eligibleIds) {
        const profile = profileByUserId.get(userId)
        if (!profile?.email) {
          hadFailure = true
          continue
        }
        const delivery = await deliveriesDb.getOrCreateSessionDelivery({
          orgId: session.org_id,
          departmentId: session.department_id,
          sessionId: session.id,
          recipientUserId: userId,
          recipientEmail: profile.email,
          deliveryType: 'RECALL_CATCHUP_INVITE',
          relatedId: set.id,
        })
        if (delivery.status === 'SENT') continue
        if (!(await deliveriesDb.claimSessionDelivery(delivery.id))) {
          hadFailure = true
          continue
        }

        try {
          const result = await mailer.emails.send({
            from: fromAddress,
            to: profile.email,
            subject: `Complete your Audio Recap catch-up — ${session.title}`,
            html: buildRecallEmailHtml({
              recipientName: profileDisplayName(profile, profile.email),
              sessionTitle: session.title,
              kind: 'CATCH_UP',
              answerUrl: `${appUrl}/recall/${makeRecallToken(session.id, userId)}`,
              deadlineStr,
            }),
          })
          if (result.error) throw new Error(result.error.message)
          await deliveriesDb.recordDeliveryAttempt({
            id: delivery.id,
            success: true,
            providerMessageId: result.data?.id,
          })
          sent++
        } catch (error) {
          hadFailure = true
          await deliveriesDb.recordDeliveryAttempt({
            id: delivery.id,
            success: false,
            error: error instanceof Error ? error.message : 'Recall invitation failed',
          }).catch(() => undefined)
          console.error(`Recall catch-up invite failed for ${userId}:`, error)
        }
      }

      if (!hadFailure) {
        await recallDb.markSetSent(set.id, 'sent_catchup_at')
        // Legacy watermarks are retired: Recall is now exclusively an absentee
        // pathway, so close them without sending attendee/boost emails.
        await recallDb.markSetSent(set.id, 'sent_attendees_at')
        await recallDb.markSetSent(set.id, 'sent_boost_at')
        processed++
      }
    } catch (error) {
      console.error(`Recall catch-up delivery failed for set ${set.id}:`, error)
    }
  }

  return NextResponse.json({ processed, sent })
}
