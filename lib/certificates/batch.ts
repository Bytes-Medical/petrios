import type { CertificateRole } from '@/lib/types'
import type { ExternalTeacherCertificateCandidate } from '@/lib/db/certificates'

export type CertificateBatchRecipient =
  | { kind: 'registered'; userId: string; role: CertificateRole }
  | { kind: 'external'; teacher: ExternalTeacherCertificateCandidate }

export interface CertificateBatchFailure {
  userId: string
  role: CertificateRole
  message: string
}

/**
 * Moderator batch order: registered teachers, external teachers, then
 * attendees. An accepted registered teacher is never also an attendee
 * recipient, so one session cannot yield both kinds of recognition.
 */
export function planCertificateBatch(input: {
  teacherIds: string[]
  attendeeIds: string[]
  externalTeachers: ExternalTeacherCertificateCandidate[]
}): CertificateBatchRecipient[] {
  const teacherIdSet = new Set(input.teacherIds)
  return [
    ...input.teacherIds.map((userId) => ({ kind: 'registered' as const, userId, role: 'TEACHER' as const })),
    ...input.externalTeachers.map((teacher) => ({ kind: 'external' as const, teacher })),
    ...input.attendeeIds
      .filter((userId) => !teacherIdSet.has(userId))
      .map((userId) => ({ kind: 'registered' as const, userId, role: 'ATTENDEE' as const })),
  ]
}

export function describeCertificateBatchRecipient(recipient: CertificateBatchRecipient): string {
  if (recipient.kind === 'external') return `external teacher ${recipient.teacher.email}`
  return `${recipient.role === 'TEACHER' ? 'teacher' : 'attendee'} ${recipient.userId}`
}

export function certificateBatchFailure(
  recipient: CertificateBatchRecipient,
  error: unknown
): CertificateBatchFailure {
  return {
    userId: recipient.kind === 'external' ? `external:${recipient.teacher.email}` : recipient.userId,
    role: recipient.kind === 'external' ? 'TEACHER' : recipient.role,
    message: error instanceof Error ? error.message : 'Certificate generation failed',
  }
}
