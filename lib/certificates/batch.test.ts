import { describe, expect, it } from 'vitest'
import {
  certificateBatchFailure,
  describeCertificateBatchRecipient,
  planCertificateBatch,
} from './batch'

const external = {
  invitationId: 'inv-1',
  email: 'guest@example.org',
  recipientName: 'Guest Teacher',
}

describe('planCertificateBatch', () => {
  it('orders registered teachers, external teachers, then attendees', () => {
    expect(
      planCertificateBatch({
        teacherIds: ['t1', 't2'],
        attendeeIds: ['a1', 'a2'],
        externalTeachers: [external],
      })
    ).toEqual([
      { kind: 'registered', userId: 't1', role: 'TEACHER' },
      { kind: 'registered', userId: 't2', role: 'TEACHER' },
      { kind: 'external', teacher: external },
      { kind: 'registered', userId: 'a1', role: 'ATTENDEE' },
      { kind: 'registered', userId: 'a2', role: 'ATTENDEE' },
    ])
  })

  it('never plans an attendee certificate for an accepted registered teacher', () => {
    const plan = planCertificateBatch({
      teacherIds: ['t1'],
      attendeeIds: ['t1', 'a1'],
      externalTeachers: [],
    })
    expect(plan).toEqual([
      { kind: 'registered', userId: 't1', role: 'TEACHER' },
      { kind: 'registered', userId: 'a1', role: 'ATTENDEE' },
    ])
  })

  it('plans teachers alone when no attendee is eligible', () => {
    expect(
      planCertificateBatch({ teacherIds: [], attendeeIds: [], externalTeachers: [external] })
    ).toEqual([{ kind: 'external', teacher: external }])
  })
})

describe('certificate batch failures', () => {
  it('identifies external teachers by normalized email and keeps role', () => {
    expect(
      certificateBatchFailure({ kind: 'external', teacher: external }, new Error('Provider down'))
    ).toEqual({ userId: 'external:guest@example.org', role: 'TEACHER', message: 'Provider down' })
    expect(
      certificateBatchFailure({ kind: 'registered', userId: 'a1', role: 'ATTENDEE' }, 'nope')
    ).toEqual({ userId: 'a1', role: 'ATTENDEE', message: 'Certificate generation failed' })
  })

  it('describes recipients for operator logs', () => {
    expect(describeCertificateBatchRecipient({ kind: 'registered', userId: 't1', role: 'TEACHER' }))
      .toBe('teacher t1')
    expect(describeCertificateBatchRecipient({ kind: 'registered', userId: 'a1', role: 'ATTENDEE' }))
      .toBe('attendee a1')
    expect(describeCertificateBatchRecipient({ kind: 'external', teacher: external }))
      .toBe('external teacher guest@example.org')
  })
})
