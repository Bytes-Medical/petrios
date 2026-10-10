import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OpsNewsletterDelivery,
  OpsNewsletterIssue,
  OpsPendingAction,
} from '@/lib/types'

/**
 * Executor tests over an in-memory ledger that mimics the DAL contracts
 * (claim CAS + lease, finish bound to the claim, seed ignoring duplicates).
 */
const state = vi.hoisted(() => ({
  issue: null as OpsNewsletterIssue | null,
  deliveries: [] as OpsNewsletterDelivery[],
  members: [] as { user_id: string; email: string }[],
  optouts: new Set<string>(),
  issueUpdates: [] as Record<string, unknown>[],
  beginResult: 'cas' as 'cas' | 'miss',
  claimReturnsNullRow: false,
  failSentWrites: 0,
  sends: [] as Record<string, unknown>[],
  sendResults: [] as { data: { id: string | null } | null; error: { message: string; statusCode?: number; retryAfterSeconds?: number } | null }[],
  nextId: 0,
}))

vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.test' }))

vi.mock('@/lib/email', () => ({
  getFromAddress: () => 'Petrios <no-reply@app.test>',
  getEmailClient: () => ({
    emails: {
      send: vi.fn(async (params: Record<string, unknown>) => {
        state.sends.push(params)
        return state.sendResults.shift() ?? { data: { id: `msg-${state.sends.length}` }, error: null }
      }),
    },
  }),
}))

vi.mock('@/lib/db/departments', () => ({
  listDepartmentMembersWithProfiles: vi.fn(async () => state.members),
  // A rename after approval must never reach the sent parts.
  findDepartment: vi.fn(async (id: string) => ({ id, name: 'Renamed Department' })),
}))

vi.mock('@/lib/db/organizations', () => ({
  findOrganizationName: vi.fn(async () => 'Renamed Trust'),
}))

vi.mock('@/lib/db/ops', () => ({
  findNewsletterIssueById: vi.fn(async () => (state.issue ? { ...state.issue } : null)),
  beginNewsletterExecution: vi.fn(async (input: { contentRevision: number; pendingActionId: string }) => {
    if (state.beginResult === 'miss' || !state.issue || state.issue.content_revision !== input.contentRevision) {
      return null
    }
    state.issue = { ...state.issue, status: 'approved', pending_action_id: input.pendingActionId }
    return { ...state.issue }
  }),
  updateNewsletterIssue: vi.fn(async (_id: string, patch: { status?: string; sentCount?: number }) => {
    state.issueUpdates.push(patch)
    if (state.issue) {
      state.issue = {
        ...state.issue,
        ...(patch.status ? { status: patch.status as OpsNewsletterIssue['status'] } : {}),
        ...(patch.sentCount !== undefined ? { sent_count: patch.sentCount } : {}),
      }
    }
  }),
  listNewsletterOptoutUserIds: vi.fn(async (_orgId: string, userIds: string[]) =>
    new Set(userIds.filter((id) => state.optouts.has(id)))
  ),
  listNewsletterDeliveries: vi.fn(async () => state.deliveries.map((row) => ({ ...row }))),
  deleteNewsletterDeliveries: vi.fn(async (_issueId: string, ids: string[]) => {
    state.deliveries = state.deliveries.filter((row) => !(ids.includes(row.id) && row.status !== 'SENT'))
  }),
  seedNewsletterDeliveries: vi.fn(async (input: {
    issue: OpsNewsletterIssue
    recipients: { userId: string; email: string }[]
  }) => {
    for (const recipient of input.recipients) {
      if (state.deliveries.some((row) => row.recipient_user_id === recipient.userId)) continue
      state.deliveries.push(makeDelivery(recipient.userId, recipient.email, 'PENDING', input.issue.content_revision))
    }
  }),
  claimNewsletterDelivery: vi.fn(async (id: string) => {
    const row = state.deliveries.find((candidate) => candidate.id === id)
    if (state.claimReturnsNullRow) return null // DAL normalises the all-NULL composite
    if (!row || !['PENDING', 'FAILED'].includes(row.status)) return null
    row.status = 'SENDING'
    row.attempt_count += 1
    return { ...row }
  }),
  finishNewsletterDelivery: vi.fn(async (input: {
    id: string
    attemptCount: number
    success: boolean
    providerMessageId?: string | null
    error?: string | null
  }) => {
    if (input.success && state.failSentWrites > 0) {
      state.failSentWrites -= 1
      throw new Error('PostgREST unavailable')
    }
    const row = state.deliveries.find((candidate) => candidate.id === input.id)
    if (!row || row.status !== 'SENDING' || row.attempt_count !== input.attemptCount) return
    row.status = input.success ? 'SENT' : 'FAILED'
    row.last_error = input.success ? null : input.error ?? null
    row.provider_message_id = input.providerMessageId ?? null
  }),
}))

import * as opsDb from '@/lib/db/ops'
import { executeNewsletterIssue } from './executors'
import { NewsletterUserError, UNSUBSCRIBE_PLACEHOLDER, verifyUnsubToken } from './newsletter'

const ORG = '11111111-1111-4111-8111-111111111111'
const DEPT = '22222222-2222-4222-8222-222222222222'
const ISSUE = '33333333-3333-4333-8333-333333333333'
const user = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeDelivery(
  userId: string,
  email: string,
  status: OpsNewsletterDelivery['status'],
  revision = 2
): OpsNewsletterDelivery {
  state.nextId += 1
  return {
    id: `delivery-${state.nextId}`,
    issue_id: ISSUE,
    org_id: ORG,
    department_id: DEPT,
    recipient_user_id: userId,
    recipient_email: email,
    content_revision: revision,
    status,
    attempt_count: status === 'PENDING' ? 0 : 1,
    provider_message_id: null,
    last_error: null,
    claimed_at: null,
    sent_at: null,
    created_at: '2026-10-10T09:00:00Z',
    updated_at: '2026-10-10T09:00:00Z',
  }
}

function makeIssue(overrides: Partial<OpsNewsletterIssue> = {}): OpsNewsletterIssue {
  return {
    id: ISSUE,
    org_id: ORG,
    department_id: DEPT,
    week_start: '2026-10-05',
    subject: 'Weekly teaching',
    html: `<p>Hello</p><a href="${UNSUBSCRIBE_PLACEHOLDER}">Unsubscribe</a>`,
    summary_points: [],
    content: { subject: 'Weekly teaching', intro: 'i', sessions: [], closing: 'c' },
    source_session_ids: [],
    source_documents: [],
    content_revision: 2,
    generated_by: user(99),
    status: 'draft',
    pending_action_id: null,
    sent_count: 0,
    created_at: '2026-10-10T09:00:00Z',
    updated_at: '2026-10-10T09:00:00Z',
    ...overrides,
  }
}

function action(overrides: Partial<OpsPendingAction> = {}): OpsPendingAction {
  return {
    id: 'action-1',
    org_id: ORG,
    department_id: DEPT,
    type: 'NEWSLETTER_ISSUE',
    payload: { issueId: ISSUE, contentRevision: 2 },
    preview_title: 'Department newsletter',
    preview_body: '',
    status: 'approved',
    created_by: user(99),
    reviewed_by: user(99),
    reviewed_at: '2026-10-10T09:00:00Z',
    executed_at: null,
    error: null,
    created_at: '2026-10-10T09:00:00Z',
    ...overrides,
  }
}

const noWait = { now: () => Date.parse('2026-10-10T10:00:00Z'), sleep: async () => {} }
const sentTo = () => state.sends.map((send) => send.to)

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  state.issue = makeIssue()
  state.deliveries = []
  state.members = [
    { user_id: user(1), email: 'One@nhs.net' },
    { user_id: user(2), email: 'two@nhs.net' },
  ]
  state.optouts = new Set()
  state.issueUpdates = []
  state.beginResult = 'cas'
  state.claimReturnsNullRow = false
  state.failSentWrites = 0
  state.sends = []
  state.sendResults = []
  state.nextId = 0
  vi.clearAllMocks()
})

describe('executeNewsletterIssue guards', () => {
  it('refuses a stale reviewed revision before any recipient work', async () => {
    await expect(executeNewsletterIssue(action({ payload: { issueId: ISSUE, contentRevision: 1 } }), noWait))
      .rejects.toThrow(NewsletterUserError)
    expect(opsDb.beginNewsletterExecution).not.toHaveBeenCalled()
    expect(state.sends).toHaveLength(0)
  })

  it('refuses a cross-organization or cross-department action', async () => {
    await expect(executeNewsletterIssue(action({ org_id: user(50) }), noWait)).rejects.toThrow('scope')
    await expect(executeNewsletterIssue(action({ department_id: user(51) }), noWait)).rejects.toThrow('scope')
    expect(state.sends).toHaveLength(0)
  })

  it('refuses a legacy organization-wide issue', async () => {
    state.issue = makeIssue({ department_id: null })
    await expect(executeNewsletterIssue(action({ department_id: null }), noWait)).rejects.toThrow('Legacy')
  })

  it('does nothing for an issue that is already wholly sent', async () => {
    state.issue = makeIssue({ status: 'sent', sent_count: 2 })
    await executeNewsletterIssue(action(), noWait)
    expect(state.sends).toHaveLength(0)
    expect(opsDb.beginNewsletterExecution).not.toHaveBeenCalled()
  })

  it('refuses to start while another execution holds the issue (or it changed after review)', async () => {
    state.beginResult = 'miss'
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow('already being delivered')
    expect(state.sends).toHaveLength(0)
    // It must not overwrite the other execution's status either.
    expect(state.issueUpdates).toEqual([])
  })

  it('sends the content returned by the start CAS, not the earlier read', async () => {
    const begin = vi.mocked(opsDb.beginNewsletterExecution)
    begin.mockImplementationOnce(async () => ({
      ...makeIssue({ status: 'approved' }),
      html: `<p>Reviewed revision</p><a href="${UNSUBSCRIBE_PLACEHOLDER}">u</a>`,
    }))
    await executeNewsletterIssue(action(), noWait)
    expect(state.sends.every((send) => String(send.html).includes('Reviewed revision'))).toBe(true)
  })
})

describe('executeNewsletterIssue audience', () => {
  it('fails closed when a current member has no email, recording the real success count', async () => {
    state.deliveries = [makeDelivery(user(1), 'one@nhs.net', 'SENT')]
    state.members.push({ user_id: user(3), email: '  ' })
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow('deliverable email')
    expect(state.sends).toHaveLength(0)
    // sent_count reflects the ledger, so the partially delivered issue stays locked.
    expect(state.issue).toMatchObject({ status: 'failed', sent_count: 1 })
  })

  it('fails instead of reporting success when nobody is eligible', async () => {
    state.optouts = new Set([user(1), user(2)])
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow('No current department member')
    expect(state.issue).toMatchObject({ status: 'failed', sent_count: 0 })
    expect(state.sends).toHaveLength(0)
  })

  it('on retry, skips members who unsubscribed or left and uses a changed address', async () => {
    state.issue = makeIssue({ status: 'failed', sent_count: 1 })
    state.deliveries = [
      makeDelivery(user(1), 'one@nhs.net', 'SENT'),
      makeDelivery(user(2), 'old-two@nhs.net', 'FAILED'), // changed address
      makeDelivery(user(3), 'three@nhs.net', 'FAILED'), // unsubscribed since
      makeDelivery(user(4), 'four@nhs.net', 'FAILED'), // left the department
    ]
    state.members = [
      { user_id: user(1), email: 'one@nhs.net' },
      { user_id: user(2), email: 'new-two@nhs.net' },
      { user_id: user(3), email: 'three@nhs.net' },
    ]
    state.optouts = new Set([user(3)])

    await executeNewsletterIssue(action(), noWait)

    expect(sentTo()).toEqual(['new-two@nhs.net'])
    expect(state.deliveries.map((row) => [row.recipient_user_id, row.status])).toEqual([
      [user(1), 'SENT'],
      [user(2), 'SENT'],
    ])
    expect(state.issue).toMatchObject({ status: 'sent', sent_count: 2 })
  })
})

describe('executeNewsletterIssue plain-text part', () => {
  const SESSION = '44444444-4444-4444-8444-444444444444'
  const content = {
    subject: 'Weekly teaching',
    intro: 'One session ran.',
    sessions: [{
      session_id: SESSION,
      title: 'Sepsis',
      date_label: 'Monday 5 October',
      overview: 'Escalate early.',
      learning_points: [],
    }],
    closing: 'Thanks.',
    render: {
      version: 1 as const,
      snapshotAt: '2026-10-12T09:00:00.000Z',
      organizationName: 'Example Trust',
      departmentName: 'Paediatrics',
      coordinators: [],
      sessions: {
        [SESSION]: {
          dateStart: '2026-10-05T09:00:00.000Z',
          dateEnd: '2026-10-05T10:00:00.000Z',
          locationType: 'IN_PERSON' as const,
          teachers: ['Dr A'],
          recap: null,
        },
      },
      upcoming: { startIso: '2026-10-12T09:00:00.000Z', endIso: '2026-10-19T09:00:00.000Z', more: 0, sessions: [] },
    },
  }

  it('sends a text part rendered from the stored snapshot, with the placeholder swapped in both parts', async () => {
    state.issue = makeIssue({ content, source_session_ids: [SESSION] })
    await executeNewsletterIssue(action(), noWait)
    expect(sentTo()).toEqual(['one@nhs.net', 'two@nhs.net'])
    for (const [index, send] of state.sends.entries()) {
      const html = String(send.html)
      const text = String(send.text)
      expect(html).not.toContain(UNSUBSCRIBE_PLACEHOLDER)
      expect(text).not.toContain(UNSUBSCRIBE_PLACEHOLDER)
      const token = text.match(/Unsubscribe: https:\/\/app\.test\/ops\/unsubscribe\/(\S+)/)?.[1]
      expect(verifyUnsubToken(token!)).toEqual({ orgId: ORG, userId: user(index + 1) })
      expect(html).toContain(`https://app.test/ops/unsubscribe/${token}`)
      expect(text).toContain('PETRIOS · PAEDIATRICS')
      expect(text).toContain('Week commencing 5 October 2026 · Example Trust')
      expect(text).toContain(`Open: https://app.test/sessions/${SESSION}`)
      expect(text).not.toContain('Renamed')
    }
  })

  it('renders the text part from the stored issue before seeding any delivery', async () => {
    const { organizationName: _org, departmentName: _dept, ...unnamed } = content.render
    state.issue = makeIssue({
      content: { ...content, render: unnamed as typeof content.render },
      source_session_ids: [SESSION],
    })
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow('Regenerate')
    expect(state.deliveries).toHaveLength(0)
    expect(state.sends).toHaveLength(0)
  })

  it('keeps a legacy issue without a render snapshot HTML-only', async () => {
    await executeNewsletterIssue(action(), noWait)
    expect(state.sends).toHaveLength(2)
    expect(state.sends.every((send) => !('text' in send))).toBe(true)
  })
})

describe('executeNewsletterIssue delivery ledger', () => {
  it('sends one personalised email per recipient with one-click unsubscribe and an idempotency key', async () => {
    await executeNewsletterIssue(action(), noWait)
    expect(sentTo()).toEqual(['one@nhs.net', 'two@nhs.net'])
    for (const [index, send] of state.sends.entries()) {
      const html = String(send.html)
      expect(html).not.toContain(UNSUBSCRIBE_PLACEHOLDER)
      const token = html.match(/https:\/\/app\.test\/ops\/unsubscribe\/([^"]+)"/)?.[1]
      expect(verifyUnsubToken(token!)).toEqual({ orgId: ORG, userId: user(index + 1) })
      expect(send.headers).toEqual({
        'List-Unsubscribe': `<https://app.test/ops/unsubscribe/${token}/one-click>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      })
      expect(send.idempotencyKey).toBe(`ops-newsletter/${state.deliveries[index].id}/2`)
    }
    expect(state.issue).toMatchObject({ status: 'sent', sent_count: 2 })
  })

  it('never re-emails SENT rows and never sends when the claim is not held', async () => {
    state.deliveries = [makeDelivery(user(1), 'one@nhs.net', 'SENT')]
    state.claimReturnsNullRow = true
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow(NewsletterUserError)
    expect(state.sends).toHaveLength(0)
  })

  it('records a partial failure with a sanitized error and the success count', async () => {
    state.sendResults = [
      { data: { id: 'msg-1' }, error: null },
      { data: null, error: { message: '550 <two@nhs.net> mailbox unavailable' } },
    ]
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow('1 newsletter delivery(s) failed')
    const failed = state.deliveries.find((row) => row.recipient_user_id === user(2))!
    expect(failed.status).toBe('FAILED')
    expect(failed.last_error).not.toContain('two@nhs.net')
    expect(state.issue).toMatchObject({ status: 'failed', sent_count: 1 })
  })

  it('never downgrades an accepted send to FAILED when the SENT write fails', async () => {
    state.members = [{ user_id: user(1), email: 'one@nhs.net' }]
    state.failSentWrites = 2 // both SENT write attempts fail
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow(NewsletterUserError)
    expect(state.deliveries[0].status).toBe('SENDING') // lease-protected, not re-claimable as FAILED
    const failureWrites = vi.mocked(opsDb.finishNewsletterDelivery).mock.calls
      .filter(([input]) => input.success === false)
    expect(failureWrites).toHaveLength(0)
  })

  it('recovers when only the first SENT write fails', async () => {
    state.members = [{ user_id: user(1), email: 'one@nhs.net' }]
    state.failSentWrites = 1
    await executeNewsletterIssue(action(), noWait)
    expect(state.deliveries[0].status).toBe('SENT')
    expect(state.issue).toMatchObject({ status: 'sent', sent_count: 1 })
  })

  it('waits out a provider rate limit and retries the same email', async () => {
    const sleeps: number[] = []
    state.members = [{ user_id: user(1), email: 'one@nhs.net' }]
    state.sendResults = [
      { data: null, error: { message: 'Too many requests', statusCode: 429, retryAfterSeconds: 2 } },
      { data: { id: 'msg-ok' }, error: null },
    ]
    await executeNewsletterIssue(action(), {
      now: () => Date.parse('2026-10-10T10:00:00Z'),
      sleep: async (ms) => { sleeps.push(ms) },
    })
    expect(state.sends).toHaveLength(2)
    expect(state.sends[0].idempotencyKey).toBe(state.sends[1].idempotencyKey)
    expect(sleeps).toContain(2000)
    expect(state.deliveries[0].status).toBe('SENT')
  })

  it('stops at the per-request time budget and leaves the rest for Retry', async () => {
    let clock = Date.parse('2026-10-10T10:00:00Z')
    state.members = Array.from({ length: 5 }, (_, index) => ({
      user_id: user(index + 1),
      email: `m${index + 1}@nhs.net`,
    }))
    await expect(executeNewsletterIssue(action(), {
      now: () => (clock += 30_000), // every clock read is 30 s later: ~1 min per recipient
      sleep: async () => {},
    })).rejects.toThrow('Retry unfinished delivery')
    const sent = state.deliveries.filter((row) => row.status === 'SENT').length
    expect(sent).toBeGreaterThan(0)
    expect(sent).toBeLessThan(5)
    expect(state.deliveries.filter((row) => row.status === 'PENDING')).toHaveLength(5 - sent)
    expect(state.issue).toMatchObject({ status: 'failed', sent_count: sent })
  })

  it('refuses a ledger row from an obsolete revision', async () => {
    state.deliveries = [makeDelivery(user(1), 'one@nhs.net', 'FAILED', 1)]
    await expect(executeNewsletterIssue(action(), noWait)).rejects.toThrow('obsolete content revision')
    expect(state.sends).toHaveLength(0)
    expect(state.issue?.status).toBe('failed')
  })
})
