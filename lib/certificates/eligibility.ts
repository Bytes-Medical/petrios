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
  userId: string
  role: CertificateRole
  orgId: string
}): Promise<CertificateEligibility> {
  const session = await certificatesDb.findSessionForCertificate(input.sessionId, input.orgId)
  if (!session) throw new Error('Session not found')
  if (session.status !== 'PUBLISHED') throw new Error('Only published sessions are eligible')
  if (new Date(session.date_end) > new Date()) {
    throw new Error('Certificates cannot be issued before the session ends')
  }
  if (session.attendance_phase !== 'FINALIZED') {
    throw new Error('Finalize attendance before issuing certificates')
  }

  const attendance = await certificatesDb.findFinalizedAttendanceForUserAsSystem(
    input.sessionId,
    input.userId
  )
  if (!attendance || !['PRESENT', 'LATE'].includes(attendance.status)) {
    throw new Error('A finalized PRESENT or LATE attendance result is required')
  }
  if (attendance.revision !== (session.attendance_revision ?? 0)) {
    throw new Error('Attendance changed after this result was finalized')
  }

  if (
    input.role === 'TEACHER' &&
    !(await certificatesDb.userIsAcceptedTeacherAsSystem(input.sessionId, input.userId))
  ) {
    throw new Error('Teacher certificates require an accepted teacher assignment')
  }

  return { attendanceRevision: attendance.revision }
}
