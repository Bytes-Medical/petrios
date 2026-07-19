import type { CertificateRole } from '@/lib/types'
import * as certificatesDb from '@/lib/db/certificates'

export interface CertificateEligibility {
  attendanceRevision: number
}

/**
 * Canonical certificate eligibility boundary. Every issue path must call this
 * before inserting a VALID certificate.
 */
export async function requireCertificateEligibility(input: {
  sessionId: string
  role: CertificateRole
  orgId: string
  userId?: string | null
  externalEmail?: string | null
  invitationId?: string | null
}): Promise<CertificateEligibility> {
  const externalEmail = input.externalEmail?.trim().toLowerCase() || null
  if ((input.userId ? 1 : 0) + (externalEmail ? 1 : 0) !== 1) {
    throw new Error('Exactly one certificate recipient identity is required')
  }
  const session = await certificatesDb.findSessionForCertificate(input.sessionId, input.orgId)
  if (!session) throw new Error('Session not found')
  if (session.status !== 'PUBLISHED') throw new Error('Only published sessions are eligible')
  if (new Date(session.date_end) > new Date()) {
    throw new Error('Certificates cannot be issued before the session ends')
  }
  if (session.attendance_phase !== 'FINALIZED') {
    throw new Error('Finalize attendance before issuing certificates')
  }

  const attendanceRevision = session.attendance_revision ?? 0

  if (input.role === 'TEACHER') {
    if (input.userId) {
      if (!(await certificatesDb.userIsAcceptedTeacherAsSystem(input.sessionId, input.userId))) {
        throw new Error('Teacher certificates require an accepted teacher assignment')
      }
    } else {
      if (!input.invitationId) {
        throw new Error('External certificates require an accepted teacher invitation')
      }
      const accepted = await certificatesDb.externalInvitationIsAcceptedAsSystem({
        sessionId: input.sessionId,
        invitationId: input.invitationId,
        externalEmail: externalEmail!,
      })
      if (!accepted) {
        throw new Error('External teacher certificates require the matching accepted invitation')
      }
    }

    // A teaching certificate recognizes the accepted teaching assignment. The
    // finalized revision remains its governance snapshot, but no attendee
    // attendance result is invented or required for the teacher.
    return { attendanceRevision }
  }

  if (!input.userId) {
    throw new Error('External identities are eligible only for teacher certificates')
  }
  if (await certificatesDb.userIsAcceptedTeacherAsSystem(input.sessionId, input.userId)) {
    throw new Error('Accepted teachers receive teaching certificates, not attendee certificates')
  }

  const attendance = await certificatesDb.findFinalizedAttendanceForUserAsSystem(
    input.sessionId,
    input.userId
  )
  if (!attendance || !['PRESENT', 'LATE'].includes(attendance.status)) {
    throw new Error('A finalized PRESENT or LATE attendance result is required')
  }
  if (attendance.revision !== attendanceRevision) {
    throw new Error('Attendance changed after this result was finalized')
  }

  return { attendanceRevision: attendance.revision }
}
