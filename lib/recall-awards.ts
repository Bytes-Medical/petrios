import { getAppUrl } from '@/lib/app-url'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import { resolveTeachingCoordinatorNames } from '@/lib/certificates/coordinators'
import { requireCertificateEligibility } from '@/lib/certificates/eligibility'
import { generateCertificateCode } from '@/lib/certificates/utils'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildCertificateEmailHtml } from '@/lib/email-templates'
import { emitWebhook } from '@/lib/webhooks'
import * as certificatesDb from '@/lib/db/certificates'
import * as deliveriesDb from '@/lib/db/session-deliveries'
import * as onboardingDb from '@/lib/db/onboarding'
import * as recallDb from '@/lib/db/recall'

interface AwardCertificate {
  id: string
  certificate_code: string
  issued_at: string
  coordinator_names: string[]
  recognition_basis: 'LIVE_ATTENDANCE' | 'AUDIO_RECAP_CATCH_UP' | 'TEACHING_ASSIGNMENT'
}

/**
 * Durable catch-up award worker shared by the answer action and retry cron.
 * Attendance recognition has already committed transactionally before this
 * runs, so a provider outage can delay delivery but can never roll learning
 * completion back or produce duplicate mail.
 */
export async function awardRecallCompletion(
  input: recallDb.RecallCompletion
): Promise<recallDb.RecallCompletion> {
  const completion = await recallDb.findCompletion(input.session_id, input.user_id)
  if (!completion) throw new Error('Catch-up completion no longer exists')
  if (completion.award_status === 'DELIVERED') return completion

  let claimedDeliveryId: string | null = null
  try {
    const [session, profiles, coordinatorSettings] = await Promise.all([
      certificatesDb.findSessionForCertificate(completion.session_id, completion.org_id),
      onboardingDb.listProfilesForUsers([completion.user_id]),
      certificatesDb.findCertificateCoordinatorNamesAsSystem(completion.department_id),
    ])
    if (!session) throw new Error('Session not found for catch-up award')
    const profile = profiles[0]
    if (!profile?.email) throw new Error('The learner does not have a deliverable email address')

    const eligibility = await requireCertificateEligibility({
      sessionId: completion.session_id,
      userId: completion.user_id,
      role: 'ATTENDEE',
      orgId: completion.org_id,
    })
    if (eligibility.attendanceRevision !== completion.attendance_revision) {
      throw new Error('Catch-up attendance revision no longer matches its completion')
    }
    if (eligibility.recognitionBasis !== 'AUDIO_RECAP_CATCH_UP') {
      throw new Error('Catch-up attendance does not have the expected recognition basis')
    }

    const recipientName = profile.full_name
      || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
      || profile.email
    const coordinatorNames = resolveTeachingCoordinatorNames(
      coordinatorSettings.coordinator_names,
      coordinatorSettings.lead_name
    )
    let certificate: AwardCertificate | null = await certificatesDb.findCertificateByUserAndSession(
      completion.user_id,
      completion.session_id,
      { role: 'ATTENDEE', includeLegacy: false }
    )
    if (!certificate) {
      const certificateCode = generateCertificateCode()
      const created = await certificatesDb.insertCertificateAsSystem({
        orgId: completion.org_id,
        departmentId: completion.department_id,
        sessionId: completion.session_id,
        userId: completion.user_id,
        role: 'ATTENDEE',
        certificateCode,
        recipientName,
        recipientEmail: profile.email,
        coordinatorNames,
        attendanceRevision: completion.attendance_revision,
        issuanceSource: 'RECALL_CATCH_UP',
        recognitionBasis: 'AUDIO_RECAP_CATCH_UP',
      })
      certificate = {
        id: created.id,
        certificate_code: created.certificate_code,
        issued_at: created.issued_at,
        coordinator_names: created.coordinator_names,
        recognition_basis: created.recognition_basis ?? 'AUDIO_RECAP_CATCH_UP',
      }
      void emitWebhook(completion.org_id, 'certificate.issued', {
        session_id: completion.session_id,
        certificate_code: certificateCode,
        role: 'ATTENDEE',
        recognition_basis: 'AUDIO_RECAP_CATCH_UP',
      })
    }
    if (!certificate) throw new Error('Certificate issuance did not return a record')
    if (certificate.recognition_basis !== 'AUDIO_RECAP_CATCH_UP') {
      throw new Error('An existing certificate has a conflicting recognition basis')
    }

    await recallDb.updateCompletionAward({
      completionId: completion.id,
      status: 'ISSUED',
      certificateId: certificate.id,
    })

    const delivery = await deliveriesDb.getOrCreateSessionDelivery({
      orgId: completion.org_id,
      departmentId: completion.department_id,
      sessionId: completion.session_id,
      recipientUserId: completion.user_id,
      recipientEmail: profile.email,
      deliveryType: 'ATTENDANCE_CERTIFICATE',
      relatedId: certificate.id,
    })
    if (delivery.status === 'SENT') {
      await recallDb.updateCompletionAward({
        completionId: completion.id,
        status: 'DELIVERED',
        certificateId: certificate.id,
      })
      return (await recallDb.findCompletion(completion.session_id, completion.user_id))!
    }
    if (!(await deliveriesDb.claimSessionDelivery(delivery.id))) {
      return (await recallDb.findCompletion(completion.session_id, completion.user_id))!
    }
    claimedDeliveryId = delivery.id

    const pdfBuffer = await generateCertificatePDF({
      orgName: session.organizations?.name || 'Organization',
      departmentName: session.departments?.name || 'Unknown',
      sessionTitle: session.title,
      sessionDate: new Date(session.date_start).toLocaleDateString('en-GB'),
      recipientName,
      role: 'Attendee',
      certificateCode: certificate.certificate_code,
      issuedDate: new Date(certificate.issued_at).toLocaleDateString('en-GB'),
      verifyUrl: `${getAppUrl()}/verify/${certificate.certificate_code}`,
      coordinatorNames: certificate.coordinator_names ?? coordinatorNames,
      recognitionBasis: 'AUDIO_RECAP_CATCH_UP',
    })
    const result = await getEmailClient().emails.send({
      from: getFromAddress(),
      to: profile.email,
      subject: `Your Audio Recap Catch-up Certificate — ${session.title}`,
      html: buildCertificateEmailHtml(session.title, recipientName, {
        attached: true,
        recognitionBasis: 'AUDIO_RECAP_CATCH_UP',
      }),
      attachments: [{
        filename: `attendance-certificate-${certificate.certificate_code}.pdf`,
        content: pdfBuffer,
      }],
    })
    if (result.error) throw new Error(result.error.message)
    await deliveriesDb.recordDeliveryAttempt({
      id: delivery.id,
      success: true,
      providerMessageId: result.data?.id,
    })
    await recallDb.updateCompletionAward({
      completionId: completion.id,
      status: 'DELIVERED',
      certificateId: certificate.id,
    })
    return (await recallDb.findCompletion(completion.session_id, completion.user_id))!
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Certificate delivery failed'
    if (claimedDeliveryId) {
      await deliveriesDb.recordDeliveryAttempt({
        id: claimedDeliveryId,
        success: false,
        error: message,
      }).catch(() => undefined)
    }
    await recallDb.updateCompletionAward({
      completionId: completion.id,
      status: 'FAILED',
      error: message,
    }).catch(() => undefined)
    throw error
  }
}
