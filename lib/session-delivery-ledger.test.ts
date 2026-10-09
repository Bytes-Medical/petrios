import { describe, expect, it } from 'vitest'
import {
  SESSION_REMINDER_MAX_ATTEMPTS,
  normalizeDeliveryEmail,
  pendingReminderRecipients,
  reminderDeliveryDecision,
} from './session-delivery-ledger'

describe('reminderDeliveryDecision', () => {
  it('sends when the recipient has no ledger row yet', () => {
    expect(reminderDeliveryDecision(undefined)).toBe('SEND')
  })

  it('never repeats a SENT reminder', () => {
    expect(reminderDeliveryDecision({ status: 'SENT', attempt_count: 1 })).toBe('SENT')
  })

  it('retries FAILED rows until the attempt cap, then stops blocking', () => {
    expect(
      reminderDeliveryDecision({ status: 'FAILED', attempt_count: SESSION_REMINDER_MAX_ATTEMPTS - 1 })
    ).toBe('SEND')
    expect(
      reminderDeliveryDecision({ status: 'FAILED', attempt_count: SESSION_REMINDER_MAX_ATTEMPTS })
    ).toBe('GAVE_UP')
  })

  it('leaves PENDING and SENDING rows to the claim', () => {
    expect(reminderDeliveryDecision({ status: 'PENDING', attempt_count: 0 })).toBe('SEND')
    expect(reminderDeliveryDecision({ status: 'SENDING', attempt_count: 5 })).toBe('SEND')
  })
})

describe('pendingReminderRecipients', () => {
  const recipients = [
    { email: 'Done@Example.org', id: 'a' },
    { email: 'retry@example.org', id: 'b' },
    { email: 'exhausted@example.org', id: 'c' },
    { email: 'new@example.org', id: 'd' },
    { email: 'busy@example.org', id: 'e' },
  ]

  it('skips finished recipients and keeps the rest in order', () => {
    const pending = pendingReminderRecipients(recipients, [
      { recipient_email: 'done@example.org', status: 'SENT', attempt_count: 1 },
      { recipient_email: 'retry@example.org', status: 'FAILED', attempt_count: 1 },
      { recipient_email: 'exhausted@example.org', status: 'FAILED', attempt_count: 3 },
      { recipient_email: 'busy@example.org', status: 'SENDING', attempt_count: 0 },
    ])
    expect(pending.map((r) => r.id)).toEqual(['b', 'd', 'e'])
  })

  it('treats every recipient as pending when the ledger is empty', () => {
    expect(pendingReminderRecipients(recipients, [])).toHaveLength(recipients.length)
  })
})

describe('normalizeDeliveryEmail', () => {
  it('matches the ledger natural key form', () => {
    expect(normalizeDeliveryEmail('  Trainee@NHS.net ')).toBe('trainee@nhs.net')
  })
})
