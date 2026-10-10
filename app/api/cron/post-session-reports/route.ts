import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { emitWebhook } from '@/lib/webhooks'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import {
  CRON_SUBREQUEST_BUDGET,
  CRON_TIME_BUDGET_MS,
  createBudgetSlice,
  createRunBudget,
} from '@/lib/run-budget'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as certificatesDb from '@/lib/db/certificates'
import * as onboardingDb from '@/lib/db/onboarding'
import * as deliveriesDb from '@/lib/db/session-deliveries'
import { requireCertificateEligibility } from '@/lib/certificates/eligibility'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'
import * as rotaDb from '@/lib/db/rota'

// Estimated subrequests reserved against the run budget. A webhook costs one
// endpoint lookup plus a POST and a delivery row per subscribed endpoint.
const SESSION_SETUP_COST = 15
const CERTIFICATE_LOOKUP_COST = 1
const DELIVERY_LOOKUP_COST = 1
const RECIPIENT_DELIVERY_COST = 20
// Units held back for each later session in the batch, so a session that
// cannot finish in one run never blocks the sessions behind it. With the batch
// cap of 10, the first of ten sessions may spend at most 8,000 - 9 * 400.
const LATER_SESSION_RESERVE = 400

/**
 * Rota-availability retention purge (spec/14), piggybacked on this hourly
 * cron so no new trigger is needed. Deletion-only, so it runs even with the
 * rota kill switch off (the one rota call that does, so the retention promise
 * holds after a switch-off). Before migration 063 it is a silent no-op, and a
 * failure never fails the cron: it is logged without details and the next
 * run (or the next ingest) retries.
 */
async function runRotaPurge(): Promise<Record<string, number> | null> {
  try {
    const purged = await rotaDb.purgeRotaData()
    return purged === 'not_installed' ? null : purged
  } catch {
    console.error('[rota] purge failed')
    return null
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const sessions = await sessionsDb.listSessionsNeedingReport()

  if (sessions.length === 0) {
    const rotaPurged = await runRotaPurge()
    return NextResponse.json({
      message: 'No sessions to process',
      processed: 0,
      rota_purged: rotaPurged,
    })
  }

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const budget = createRunBudget({
    maxUnits: CRON_SUBREQUEST_BUDGET,
    maxDurationMs: CRON_TIME_BUDGET_MS,
  })

  let processedCount = 0
  let deferredSessions = 0
  let deferredRecipients = 0

  for (const [sessionIndex, session] of sessions.entries()) {
    const laterSessions = sessions.length - sessionIndex - 1
    const sessionBudget = createBudgetSlice(
      budget,
      budget.remaining - laterSessions * LATER_SESSION_RESERVE
    )
    if (!sessionBudget.take(SESSION_SETUP_COST)) {
      if (budget.exhausted) {
        deferredSessions += sessions.length - sessionIndex
        break
      }
      deferredSessions++
      continue
    }

    try {
      // Integration event: attendance for this session has been computed.
      await emitWebhook(session.org_id, 'attendance.computed', {
        session_id: session.id,
      })

      // 3. Live attendees (LATE still attended). RECALL-primary learners use
      // the dedicated award worker so their PDF/email keeps its catch-up basis.
      const [allAttendeeIds, acceptedTeacherIds, recallCatchupIds, sentDeliveries] =
        await Promise.all([
          attendanceDb.listAttendeeUserIdsByStatusAsSystem(session.id, ['PRESENT', 'LATE']),
          certificatesDb.listAcceptedRegisteredTeacherIdsAsSystem(session.id),
          attendanceDb.listAttendeeUserIdsBySourceAsSystem(session.id, 'RECALL'),
          deliveriesDb.listSessionDeliveries({
            sessionId: session.id,
            deliveryType: 'ATTENDANCE_CERTIFICATE',
            status: 'SENT',
          }),
        ])
      const teacherIdSet = new Set(acceptedTeacherIds)
      const recallCatchupIdSet = new Set(recallCatchupIds)
      // A person teaching this session receives the role-specific teaching
      // certificate through the moderator batch, never a duplicate attendee
      // certificate merely because their attendance was PRESENT/LATE.
      const attendeeIds = allAttendeeIds.filter(
        (userId) => !teacherIdSet.has(userId) && !recallCatchupIdSet.has(userId)
      )

      if (attendeeIds.length === 0) {
        await sessionsDb.markSessionReportSent(session.id)
        processedCount++
        continue
      }

      // Deliveries are keyed by certificate id, so a replacement certificate
      // after a reopen is never mistaken for one already delivered. The bulk
      // read is a single page (the API row cap applies, and earlier revisions'
      // and catch-up rows count toward it), so it is only a fast path: a miss
      // is confirmed with an exact lookup before paying for a delivery.
      const deliveredCertificateIds = new Set(
        sentDeliveries.flatMap((delivery) => (delivery.related_id ? [delivery.related_id] : []))
      )
      const profiles = await onboardingDb.listProfilesForUsers(attendeeIds)
      const profileByUserId = new Map(profiles.map((p) => [p.user_id, p]))
      const coordinatorSettings =
        await certificatesDb.findCertificateCoordinatorNamesAsSystem(session.department_id)
      const coordinatorNames = resolveTeachingCoordinatorNames(
        coordinatorSettings.coordinator_names,
        coordinatorSettings.lead_name
      )
      let sessionHadFailure = false
      let sessionDeferred = false

      // 4. Issue certificates and email each attendee
      for (const [attendeeIndex, attendeeId] of attendeeIds.entries()) {
        if (!sessionBudget.take(CERTIFICATE_LOOKUP_COST)) {
          deferredRecipients += attendeeIds.length - attendeeIndex
          sessionDeferred = true
          break
        }

        let claimedDeliveryId: string | null = null
        try {
          const profile = profileByUserId.get(attendeeId)
          if (!profile?.email) {
            sessionHadFailure = true
            continue
          }

          const existingCert = await certificatesDb.findCertificateByUserAndSession(
            attendeeId,
            session.id,
            { role: 'ATTENDEE', includeLegacy: false }
          )
          if (existingCert) {
            if (deliveredCertificateIds.has(existingCert.id)) continue
            if (!sessionBudget.take(DELIVERY_LOOKUP_COST)) {
              deferredRecipients += attendeeIds.length - attendeeIndex
              sessionDeferred = true
              break
            }
            const sent = await deliveriesDb.listSessionDeliveries({
              sessionId: session.id,
              deliveryType: 'ATTENDANCE_CERTIFICATE',
              relatedId: existingCert.id,
              status: 'SENT',
            })
            if (sent.length > 0) continue
          }

          if (!sessionBudget.take(RECIPIENT_DELIVERY_COST)) {
            deferredRecipients += attendeeIds.length - attendeeIndex
            sessionDeferred = true
            break
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
              recognitionBasis: eligibility.recognitionBasis,
            })
            certificateId = certificate.id
            await emitWebhook(session.org_id, 'certificate.issued', {
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
      // complete in one pass. Failed rows remain individually retryable,
      // successful rows are skipped on the next invocation, and recipients the
      // run budget did not reach are picked up by the next run.
      if (sessionDeferred) {
        deferredSessions++
      } else if (!sessionHadFailure) {
        await sessionsDb.markSessionReportSent(session.id)
        processedCount++
      }
    } catch (err) {
      console.error(`Failed to process session ${session.id}:`, err)
    }
  }

  const rotaPurged = await runRotaPurge()

  return NextResponse.json({
    message: `Processed ${processedCount} of ${sessions.length} sessions`,
    processed: processedCount,
    total: sessions.length,
    deferredSessions,
    deferredRecipients,
    rota_purged: rotaPurged,
  })
}
