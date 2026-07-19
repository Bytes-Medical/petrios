import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { emitWebhook } from '@/lib/webhooks'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'
import * as deliveriesDb from '@/lib/db/session-deliveries'
import { requireCertificateEligibility } from '@/lib/certificates/eligibility'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'

export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const sessions = await sessionsDb.listSessionsNeedingReport()

  if (sessions.length === 0) {
    return NextResponse.json({ message: 'No sessions to process', processed: 0 })
  }

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()

  let processedCount = 0

  for (const session of sessions) {
    try {
      // Certificate recognition is downstream of human-reviewed finalization.
      // Leave the session eligible for a later run until that gate is complete.
      if (session.attendance_phase !== 'FINALIZED') continue

      // Integration event: attendance for this session has been computed.
      void emitWebhook(session.org_id, 'attendance.computed', {
        session_id: session.id,
      })

      // 3. Attendees who were actually there (LATE still attended)
      const [allAttendeeIds, acceptedTeacherIds] = await Promise.all([
        attendanceDb.listAttendeeUserIdsByStatusAsSystem(session.id, ['PRESENT', 'LATE']),
        certificatesDb.listAcceptedRegisteredTeacherIdsAsSystem(session.id),
      ])
      const teacherIdSet = new Set(acceptedTeacherIds)
      // A person teaching this session receives the role-specific teaching
      // certificate through the moderator batch, never a duplicate attendee
      // certificate merely because their attendance was PRESENT/LATE.
      const attendeeIds = allAttendeeIds.filter((userId) => !teacherIdSet.has(userId))

      if (attendeeIds.length === 0) {
        await sessionsDb.markSessionReportSent(session.id)
        processedCount++
        continue
      }

      const profiles = await onboardingDb.listProfilesForUsers(attendeeIds)
      const profileByUserId = new Map(profiles.map((p) => [p.user_id, p]))
      const coordinatorSettings =
        await certificatesDb.findCertificateCoordinatorNamesAsSystem(session.department_id)
      const coordinatorNames = resolveTeachingCoordinatorNames(
        coordinatorSettings.coordinator_names,
        coordinatorSettings.lead_name
      )
      let sessionHadFailure = false

      // 4. Issue certificates and email each attendee
      for (const attendeeId of attendeeIds) {
        let claimedDeliveryId: string | null = null
        try {
          const profile = profileByUserId.get(attendeeId)
          if (!profile?.email) {
            sessionHadFailure = true
            continue
          }

          const eligibility = await requireCertificateEligibility({
            sessionId: session.id,
            userId: attendeeId,
            role: 'ATTENDEE',
            orgId: session.org_id,
          })

          const recipientName =
            profile.full_name ||
            [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
            profile.email

          const existingCert = await certificatesDb.findCertificateByUserAndSession(
            attendeeId,
            session.id,
            { role: 'ATTENDEE', includeLegacy: false }
          )

          let certificateId = existingCert?.id ?? null
          if (!existingCert) {
            const code = generateCertificateCode()
            const certificate = await certificatesDb.insertCertificateAsSystem({
              orgId: session.org_id,
              departmentId: session.department_id,
              sessionId: session.id,
              userId: attendeeId,
              role: 'ATTENDEE',
              certificateCode: code,
              recipientName,
              recipientEmail: profile.email,
              coordinatorNames,
              attendanceRevision: eligibility.attendanceRevision,
              issuanceSource: 'POST_SESSION_REPORT',
            })
            certificateId = certificate.id
            void emitWebhook(session.org_id, 'certificate.issued', {
              session_id: session.id,
              certificate_code: code,
              role: 'ATTENDEE',
            })
          }

          if (!certificateId) throw new Error('Certificate issuance did not return a record')

          const html = buildCertificateEmailHtml(session.title, recipientName)
          const delivery = await deliveriesDb.getOrCreateSessionDelivery({
            orgId: session.org_id,
            departmentId: session.department_id,
            sessionId: session.id,
            recipientUserId: attendeeId,
            recipientEmail: profile.email,
            deliveryType: 'ATTENDANCE_CERTIFICATE',
            relatedId: certificateId,
          })
          if (delivery.status === 'SENT') continue
          if (!(await deliveriesDb.claimSessionDelivery(delivery.id))) {
            sessionHadFailure = true
            continue
          }
          claimedDeliveryId = delivery.id

          const sendResult = await mailer.emails.send({
            from: fromAddress,
            to: profile.email,
            subject: `Your Attendance Certificate — ${session.title}`,
            html,
          })
          await deliveriesDb.recordDeliveryAttempt({
            id: delivery.id,
            success: !sendResult.error,
            providerMessageId: sendResult.data?.id,
            error: sendResult.error?.message,
          })
          if (sendResult.error) {
            sessionHadFailure = true
            console.error(`Failed to send report to attendee ${attendeeId}: ${sendResult.error.message}`)
          }
        } catch (err) {
          sessionHadFailure = true
          if (claimedDeliveryId) {
            await deliveriesDb.recordDeliveryAttempt({
              id: claimedDeliveryId,
              success: false,
              error: err instanceof Error ? err.message : 'Certificate delivery failed',
            }).catch((deliveryError) => {
              console.error(`Failed to record delivery failure for attendee ${attendeeId}:`, deliveryError)
            })
          }
          console.error(`Failed to send report to attendee ${attendeeId}:`, err)
        }
      }

      // Only close the session-level selector once every recipient delivery is
      // complete. Failed rows remain individually retryable and successful rows
      // are skipped on the next invocation.
      if (!sessionHadFailure) {
        await sessionsDb.markSessionReportSent(session.id)
        processedCount++
      }
    } catch (err) {
      console.error(`Failed to process session ${session.id}:`, err)
    }
  }

  return NextResponse.json({
    message: `Processed ${processedCount} of ${sessions.length} sessions`,
    processed: processedCount,
    total: sessions.length,
  })
}
