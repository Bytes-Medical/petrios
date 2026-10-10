import { describe, expect, it } from 'vitest'
import type { OpsNewsletterContent, OpsNewsletterDelivery } from '@/lib/types'
import {
  createSendPacer,
  NEWSLETTER_EXECUTION_LEASE_MS,
  NEWSLETTER_SEND_TIME_BUDGET_MS,
  newsletterIdempotencyKey,
  newsletterIssueControls,
  newsletterUnsubscribeUrls,
  NewsletterUserError,
  normalizeNewsletterEdit,
  planNewsletterRecipients,
  sanitizeNewsletterDeliveryError,
  staleNewsletterDeliveryIds,
  tallyNewsletterDeliveries,
} from './newsletter'

const SESSION_A = '11111111-1111-4111-8111-111111111111'
const SESSION_B = '22222222-2222-4222-8222-222222222222'

const snapshotContent: OpsNewsletterContent = {
  subject: 'Week in teaching',
  intro: 'Two sessions ran.',
  sessions: [
    {
      session_id: SESSION_A,
      title: 'Sepsis recognition',
      date_label: 'Monday 6 July, 09:00',
      overview: 'Early escalation.',
      learning_points: ['Escalate early'],
    },
    {
      session_id: SESSION_B,
      title: 'Airway skills',
      date_label: 'Tuesday 7 July, 14:00',
      overview: 'Basic airway manoeuvres.',
      learning_points: ['Head tilt, chin lift'],
    },
  ],
  closing: 'Thanks all.',
}

const snapshot = { content: snapshotContent, source_session_ids: [SESSION_A, SESSION_B] }

describe('normalizeNewsletterEdit', () => {
  it('keeps edited narrative but binds title and date to the stored snapshot', () => {
    const crafted: OpsNewsletterContent = {
      ...snapshotContent,
      intro: 'Edited intro.',
      sessions: snapshotContent.sessions.map((section) => ({
        ...section,
        title: 'Forged title',
        date_label: 'Forged date',
        overview: `${section.overview} (edited)`,
      })),
    }
    const result = normalizeNewsletterEdit(snapshot, crafted)
    expect(result.intro).toBe('Edited intro.')
    expect(result.sessions.map((section) => section.title)).toEqual(['Sepsis recognition', 'Airway skills'])
    expect(result.sessions.map((section) => section.date_label)).toEqual([
      'Monday 6 July, 09:00',
      'Tuesday 7 July, 14:00',
    ])
    expect(result.sessions[0].overview).toBe('Early escalation. (edited)')
  })

  it('rejects a crafted session swap, omission or duplication as an expected error', () => {
    const swapped = {
      ...snapshotContent,
      sessions: [
        snapshotContent.sessions[0],
        { ...snapshotContent.sessions[1], session_id: '33333333-3333-4333-8333-333333333333' },
      ],
    }
    expect(() => normalizeNewsletterEdit(snapshot, swapped)).toThrow(NewsletterUserError)
    expect(() => normalizeNewsletterEdit(snapshot, {
      ...snapshotContent,
      sessions: [snapshotContent.sessions[0]],
    })).toThrow('exactly once')
    expect(() => normalizeNewsletterEdit(snapshot, {
      ...snapshotContent,
      sessions: [snapshotContent.sessions[0], snapshotContent.sessions[0]],
    })).toThrow(NewsletterUserError)
  })

  it('rejects an empty learning-point list', () => {
    expect(() => normalizeNewsletterEdit(snapshot, {
      ...snapshotContent,
      sessions: [{ ...snapshotContent.sessions[0], learning_points: [] }, snapshotContent.sessions[1]],
    })).toThrow(NewsletterUserError)
  })
})

describe('newsletterIssueControls', () => {
  const now = new Date('2026-10-10T10:00:00Z')
  const issue = (overrides: Partial<{ status: 'draft' | 'approved' | 'sent' | 'failed'; sent_count: number; updated_at: string }> = {}) => ({
    status: 'draft' as const,
    sent_count: 0,
    updated_at: '2026-10-10T09:00:00Z',
    content: snapshotContent,
    ...overrides,
  })

  it('lets an untouched draft or failed issue be edited and regenerated, not retried', () => {
    for (const status of ['draft', 'failed'] as const) {
      expect(newsletterIssueControls(issue({ status }), false, now)).toEqual({
        editable: true,
        regenerable: true,
        inProgress: false,
        canRetry: false,
      })
    }
  })

  it('locks editing when the ledger holds SENT/SENDING rows even though sent_count is 0', () => {
    expect(newsletterIssueControls(issue({ status: 'failed' }), true, now)).toEqual({
      editable: false,
      regenerable: false,
      inProgress: false,
      canRetry: true,
    })
  })

  it('treats a recent approved execution as in progress and refuses Retry until its lease expires', () => {
    const recent = issue({ status: 'approved', updated_at: new Date(now.getTime() - 60_000).toISOString() })
    expect(newsletterIssueControls(recent, false, now)).toMatchObject({ inProgress: true, canRetry: false, editable: false })
    const stale = issue({
      status: 'approved',
      updated_at: new Date(now.getTime() - NEWSLETTER_EXECUTION_LEASE_MS - 1).toISOString(),
    })
    expect(newsletterIssueControls(stale, false, now)).toMatchObject({ inProgress: false, canRetry: true })
  })

  it('offers nothing for a wholly sent issue', () => {
    expect(newsletterIssueControls(issue({ status: 'sent', sent_count: 12 }), true, now)).toEqual({
      editable: false,
      regenerable: false,
      inProgress: false,
      canRetry: false,
    })
  })

  it('keeps the per-request send budget inside the execution lease', () => {
    expect(NEWSLETTER_SEND_TIME_BUDGET_MS).toBeLessThan(NEWSLETTER_EXECUTION_LEASE_MS)
  })
})

describe('planNewsletterRecipients', () => {
  it('excludes opt-outs, normalizes addresses, de-duplicates, and counts missing emails', () => {
    const plan = planNewsletterRecipients(
      [
        { user_id: 'u1', email: ' Alice@NHS.net ' },
        { user_id: 'u2', email: 'bob@nhs.net' },
        { user_id: 'u3', email: 'alice@nhs.net' }, // second account, same mailbox
        { user_id: 'u4', email: '   ' },
        { user_id: 'u5', email: 'opted@nhs.net' },
        { user_id: 'u1', email: 'alice@nhs.net' }, // duplicate membership row
      ],
      new Set(['u5'])
    )
    expect(plan.recipients).toEqual([
      { userId: 'u1', email: 'alice@nhs.net' },
      { userId: 'u2', email: 'bob@nhs.net' },
    ])
    expect(plan.missingEmail).toBe(1)
  })

  it('does not count a missing email for a member who opted out', () => {
    expect(planNewsletterRecipients([{ user_id: 'u1', email: '' }], new Set(['u1'])))
      .toEqual({ recipients: [], missingEmail: 0 })
  })
})

function delivery(
  id: string,
  userId: string,
  email: string,
  status: OpsNewsletterDelivery['status']
): Pick<OpsNewsletterDelivery, 'id' | 'status' | 'recipient_user_id' | 'recipient_email'> {
  return { id, status, recipient_user_id: userId, recipient_email: email }
}

describe('staleNewsletterDeliveryIds', () => {
  it('drops unsent rows for members who left, opted out, or changed address; never SENT rows', () => {
    const ledger = [
      delivery('d1', 'u1', 'a@nhs.net', 'SENT'), // left after receiving it: keep history
      delivery('d2', 'u2', 'b@nhs.net', 'FAILED'), // still a member, same address
      delivery('d3', 'u3', 'c@nhs.net', 'FAILED'), // opted out since
      delivery('d4', 'u4', 'old@nhs.net', 'PENDING'), // address changed
      delivery('d5', 'u5', 'e@nhs.net', 'SENDING'), // removed from department
    ]
    const recipients = [
      { userId: 'u2', email: 'b@nhs.net' },
      { userId: 'u4', email: 'new@nhs.net' },
    ]
    expect(staleNewsletterDeliveryIds(ledger, recipients)).toEqual(['d3', 'd4', 'd5'])
  })
})

describe('tallyNewsletterDeliveries', () => {
  it('counts successes and treats SENDING as unfinished but locking', () => {
    expect(tallyNewsletterDeliveries([{ status: 'SENT' }, { status: 'SENDING' }, { status: 'FAILED' }]))
      .toEqual({ sent: 1, unfinished: 2, locked: true })
    expect(tallyNewsletterDeliveries([{ status: 'FAILED' }, { status: 'PENDING' }]))
      .toEqual({ sent: 0, unfinished: 2, locked: false })
    expect(tallyNewsletterDeliveries([])).toEqual({ sent: 0, unfinished: 0, locked: false })
  })
})

describe('delivery helpers', () => {
  it('derives a stable idempotency key per recipient row and revision', () => {
    expect(newsletterIdempotencyKey({ id: 'd-1', content_revision: 3 })).toBe('ops-newsletter/d-1/3')
    expect(newsletterIdempotencyKey({ id: 'd-1', content_revision: 4 }))
      .not.toBe(newsletterIdempotencyKey({ id: 'd-1', content_revision: 3 }))
  })

  it('sanitizes provider errors before they are persisted', () => {
    const sanitized = sanitizeNewsletterDeliveryError(
      `550 5.1.1 <Jane.Doe@nhs.net>: Recipient address rejected\n  ${'x'.repeat(500)}`
    )
    expect(sanitized).not.toContain('Jane.Doe@nhs.net')
    expect(sanitized).toContain('[address]')
    expect(sanitized).not.toContain('\n')
    expect(sanitized.length).toBeLessThanOrEqual(300)
    expect(sanitizeNewsletterDeliveryError('')).toBe('Newsletter delivery failed')
    expect(sanitizeNewsletterDeliveryError(undefined)).toBe('Newsletter delivery failed')
  })

  it('builds the confirmation page and one-click URLs', () => {
    expect(newsletterUnsubscribeUrls('https://app.test/', 'org.user.sig')).toEqual({
      page: 'https://app.test/ops/unsubscribe/org.user.sig',
      oneClick: 'https://app.test/ops/unsubscribe/org.user.sig/one-click',
    })
  })

  it('paces sends at least the interval apart', async () => {
    let clock = 1_000
    const sleeps: number[] = []
    const pace = createSendPacer(500, {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    await pace() // first send: no wait
    clock += 100
    await pace() // 100ms later: waits the remaining 400ms
    clock += 900
    await pace() // already past the interval: no wait
    expect(sleeps).toEqual([400])
  })
})
