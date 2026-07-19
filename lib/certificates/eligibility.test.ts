import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  findSessionForCertificate: vi.fn(),
  findFinalizedAttendanceForUserAsSystem: vi.fn(),
  userIsAcceptedTeacherAsSystem: vi.fn(),
  externalInvitationIsAcceptedAsSystem: vi.fn(),
}))

vi.mock('@/lib/db/certificates', () => db)

import { requireCertificateEligibility } from './eligibility'

beforeEach(() => {
  vi.clearAllMocks()
  db.findSessionForCertificate.mockResolvedValue({
    status: 'PUBLISHED',
    date_end: '2026-01-01T00:00:00.000Z',
    attendance_phase: 'FINALIZED',
    attendance_revision: 3,
  })
})

describe('canonical external teacher certificate eligibility', () => {
  it('accepts an invited external teacher without inventing attendee attendance', async () => {
    db.externalInvitationIsAcceptedAsSystem.mockResolvedValue(true)

    await expect(requireCertificateEligibility({
      sessionId: 'session-1',
      orgId: 'org-1',
      role: 'TEACHER',
      externalEmail: ' External@Example.com ',
      invitationId: 'invitation-1',
    })).resolves.toEqual({ attendanceRevision: 3 })
    expect(db.externalInvitationIsAcceptedAsSystem).toHaveBeenCalledWith({
      sessionId: 'session-1',
      invitationId: 'invitation-1',
      externalEmail: 'external@example.com',
    })
  })

  it('rejects an external teacher whose matching invitation was not accepted', async () => {
    db.externalInvitationIsAcceptedAsSystem.mockResolvedValue(false)

    await expect(requireCertificateEligibility({
      sessionId: 'session-1',
      orgId: 'org-1',
      role: 'TEACHER',
      externalEmail: 'external@example.com',
      invitationId: 'invitation-1',
    })).rejects.toThrow('matching accepted invitation')
  })

  it('rejects an external identity for an attendee certificate', async () => {
    await expect(requireCertificateEligibility({
      sessionId: 'session-1',
      orgId: 'org-1',
      role: 'ATTENDEE',
      externalEmail: 'external@example.com',
      invitationId: 'invitation-1',
    })).rejects.toThrow('External identities are eligible only for teacher certificates')
  })

  it('accepts a registered teacher from their accepted assignment without attendance', async () => {
    db.userIsAcceptedTeacherAsSystem.mockResolvedValue(true)

    await expect(requireCertificateEligibility({
      sessionId: 'session-1',
      orgId: 'org-1',
      role: 'TEACHER',
      userId: 'teacher-1',
    })).resolves.toEqual({ attendanceRevision: 3 })
    expect(db.findFinalizedAttendanceForUserAsSystem).not.toHaveBeenCalled()
  })

  it('requires current present or late attendance for a non-teacher attendee', async () => {
    db.userIsAcceptedTeacherAsSystem.mockResolvedValue(false)
    db.findFinalizedAttendanceForUserAsSystem.mockResolvedValue({
      status: 'PRESENT',
      revision: 3,
    })

    await expect(requireCertificateEligibility({
      sessionId: 'session-1',
      orgId: 'org-1',
      role: 'ATTENDEE',
      userId: 'attendee-1',
    })).resolves.toEqual({ attendanceRevision: 3 })
  })

  it('prevents an accepted teacher receiving a duplicate attendee certificate', async () => {
    db.userIsAcceptedTeacherAsSystem.mockResolvedValue(true)

    await expect(requireCertificateEligibility({
      sessionId: 'session-1',
      orgId: 'org-1',
      role: 'ATTENDEE',
      userId: 'teacher-1',
    })).rejects.toThrow('teaching certificates, not attendee certificates')
    expect(db.findFinalizedAttendanceForUserAsSystem).not.toHaveBeenCalled()
  })
})
