import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginNewsletterExecution,
  claimNewsletterDelivery,
  finishNewsletterDelivery,
  listNewsletterDeliveries,
  replaceNewsletterDraft,
} from './ops'
import {
  listAcceptedTeacherNamesForSessions,
  listDepartmentSessionsStartingInWindow,
} from './ops-reads'
import { listApprovedRecapDurations } from './audio-recaps'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://postgrest.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

function call(index = 0) {
  const [url, init] = fetchMock.mock.calls[index]
  const parsed = new URL(String(url))
  return {
    path: parsed.pathname,
    params: [...parsed.searchParams.entries()],
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    headers: new Headers(init?.headers as HeadersInit | undefined),
  }
}

const NULL_DELIVERY = {
  id: null,
  issue_id: null,
  org_id: null,
  department_id: null,
  recipient_user_id: null,
  recipient_email: null,
  content_revision: null,
  status: null,
  attempt_count: null,
  provider_message_id: null,
  last_error: null,
  claimed_at: null,
  sent_at: null,
  created_at: null,
  updated_at: null,
}

describe('claimNewsletterDelivery', () => {
  it('treats the all-NULL composite PostgREST returns for a missed claim as "not claimed"', async () => {
    // A non-SETOF plpgsql function that RETURNs a NULL %ROWTYPE is serialised
    // by PostgREST as one object whose every field is null — not as null.
    fetchMock.mockResolvedValue(json(NULL_DELIVERY))
    await expect(claimNewsletterDelivery('delivery-1')).resolves.toBeNull()
    expect(call().path).toBe('/rest/v1/rpc/claim_ops_newsletter_delivery_v1')
  })

  it('returns a genuinely claimed row', async () => {
    const row = { ...NULL_DELIVERY, id: 'delivery-1', status: 'SENDING', attempt_count: 2 }
    fetchMock.mockResolvedValue(json(row))
    await expect(claimNewsletterDelivery('delivery-1')).resolves.toMatchObject({
      id: 'delivery-1',
      attempt_count: 2,
    })
  })
})

describe('finishNewsletterDelivery', () => {
  it('only finishes the claim it belongs to (status SENDING and the same attempt)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await finishNewsletterDelivery({
      id: 'delivery-1',
      attemptCount: 3,
      success: false,
      error: 'Resend request failed (500)',
    })
    const request = call()
    expect(request.method).toBe('PATCH')
    expect(request.params).toEqual(expect.arrayContaining([
      ['id', 'eq.delivery-1'],
      ['status', 'eq.SENDING'],
      ['attempt_count', 'eq.3'],
    ]))
    expect(request.body).toMatchObject({ status: 'FAILED', last_error: 'Resend request failed (500)' })
  })
})

describe('replaceNewsletterDraft', () => {
  it('bumps the revision past the replaced one and compare-and-sets on it', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'issue-1', content_revision: 4 }]))
    await replaceNewsletterDraft({
      id: 'issue-1',
      orgId: 'org-1',
      departmentId: 'dept-1',
      expectedRevision: 3,
      generatedBy: 'user-1',
      subject: 'Subject',
      html: '<p>x</p>',
      summaryPoints: [],
      content: { subject: 'Subject', intro: 'Intro', sessions: [], closing: 'Close' },
      sourceSessionIds: [],
      sourceDocuments: [],
    })
    const request = call()
    expect(request.body.content_revision).toBe(4)
    expect(request.params).toEqual(expect.arrayContaining([
      ['content_revision', 'eq.3'],
      ['sent_count', 'eq.0'],
      ['status', 'in.(draft,failed)'],
    ]))
  })

  it('returns null when another tab changed the draft first', async () => {
    fetchMock.mockResolvedValue(json([]))
    await expect(replaceNewsletterDraft({
      id: 'issue-1',
      orgId: 'org-1',
      departmentId: 'dept-1',
      expectedRevision: 3,
      generatedBy: 'user-1',
      subject: 'Subject',
      html: '<p>x</p>',
      summaryPoints: [],
      content: { subject: 'Subject', intro: 'Intro', sessions: [], closing: 'Close' },
      sourceSessionIds: [],
      sourceDocuments: [],
    })).resolves.toBeNull()
  })
})

describe('beginNewsletterExecution', () => {
  it('moves only the reviewed revision from draft/failed (or a stale approved lease) to approved', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'issue-1', status: 'approved', content_revision: 2 }]))
    const issue = await beginNewsletterExecution({
      id: 'issue-1',
      orgId: 'org-1',
      departmentId: 'dept-1',
      contentRevision: 2,
      staleBefore: '2026-10-10T09:50:00.000Z',
      pendingActionId: 'action-1',
    })
    expect(issue).toMatchObject({ id: 'issue-1', status: 'approved' })
    const request = call()
    expect(request.method).toBe('PATCH')
    expect(request.body).toMatchObject({ status: 'approved', pending_action_id: 'action-1' })
    expect(request.params).toEqual(expect.arrayContaining([
      ['id', 'eq.issue-1'],
      ['org_id', 'eq.org-1'],
      ['department_id', 'eq.dept-1'],
      ['content_revision', 'eq.2'],
      ['or', '(status.in.(draft,failed),and(status.eq.approved,updated_at.lt.2026-10-10T09:50:00.000Z))'],
    ]))
  })

  it('returns null when a concurrent execution or edit holds the issue', async () => {
    fetchMock.mockResolvedValue(json([]))
    await expect(beginNewsletterExecution({
      id: 'issue-1',
      orgId: 'org-1',
      departmentId: 'dept-1',
      contentRevision: 2,
      staleBefore: '2026-10-10T09:50:00.000Z',
      pendingActionId: 'action-1',
    })).resolves.toBeNull()
  })
})

describe('listNewsletterDeliveries', () => {
  it('pages past the PostgREST max-rows cap so large ledgers are never truncated', async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `d-${start + index}`, status: 'SENT' }))
    fetchMock
      .mockResolvedValueOnce(json(page(0, 1000)))
      .mockResolvedValueOnce(json(page(1000, 3)))
    const rows = await listNewsletterDeliveries('issue-1')
    expect(rows).toHaveLength(1003)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('newsletter render-snapshot reads', () => {
  it('lists upcoming teaching for one department, PUBLISHED only, with an exact total', async () => {
    fetchMock.mockResolvedValue(json(
      [{ id: 's-1', date_start: '2026-10-13T11:30:00+00:00' }],
      200,
      { 'Content-Range': '0-0/9' }
    ))
    const result = await listDepartmentSessionsStartingInWindow(
      'org-1', 'dept-1', '2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z', 7
    )
    expect(result).toMatchObject({ total: 9, sessions: [{ id: 's-1' }] })
    const request = call()
    expect(request.path).toBe('/rest/v1/sessions')
    expect(request.params).toEqual(expect.arrayContaining([
      ['org_id', 'eq.org-1'],
      ['department_id', 'eq.dept-1'],
      ['status', 'eq.PUBLISHED'],
      ['date_start', 'gte.2026-10-12T00:00:00.000Z'],
      ['date_start', 'lt.2026-10-19T00:00:00.000Z'],
      ['limit', '7'],
    ]))
    expect(request.headers.get('Prefer')).toContain('count=exact')
  })

  it('lists approved recap durations only, never the audio', async () => {
    fetchMock.mockResolvedValue(json([{ session_id: 's-1', audio_duration_seconds: 312, source_digest: 'd1' }]))
    await expect(listApprovedRecapDurations(['s-1', 's-2'])).resolves.toEqual([
      { session_id: 's-1', audio_duration_seconds: 312, source_digest: 'd1' },
    ])
    const request = call()
    expect(request.path).toBe('/rest/v1/audio_recaps')
    expect(request.params).toEqual(expect.arrayContaining([
      ['select', 'session_id,audio_duration_seconds,source_digest'],
      ['session_id', 'in.(s-1,s-2)'],
      ['status', 'eq.approved'],
      ['audio_bytes', 'gt.0'],
      ['audio_duration_seconds', 'not.is.null'],
    ]))
    await expect(listApprovedRecapDurations([])).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names accepted teachers only (registered first, then external), deduplicated, never by email', async () => {
    fetchMock.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname
      if (path === '/rest/v1/session_teachers') {
        return json([
          { session_id: 's-1', user_id: 'u-1', status: 'ACCEPTED' },
          { session_id: 's-1', user_id: 'u-2', status: 'PENDING' },
          { session_id: 's-1', user_id: 'u-3', status: 'ACCEPTED' },
          { session_id: 's-2', user_id: 'u-4', status: 'ACCEPTED' },
        ])
      }
      if (path === '/rest/v1/teacher_invitations') {
        return json([
          { id: 'i-1', session_id: 's-1', email: 'ext@nhs.net', first_name: 'Joanne', last_name: 'Pryce', invite_code: 'x', status: 'ACCEPTED' },
          { id: 'i-2', session_id: 's-1', email: 'dup@nhs.net', first_name: 'hannah', last_name: 'WHITFIELD', invite_code: 'y', status: 'ACCEPTED' },
          { id: 'i-3', session_id: 's-1', email: 'declined@nhs.net', first_name: 'Dee', last_name: 'Clined', invite_code: 'z', status: 'DECLINED' },
          { id: 'i-4', session_id: 's-2', email: 'noname@nhs.net', first_name: null, last_name: null, invite_code: 'w', status: 'ACCEPTED' },
        ])
      }
      if (path === '/rest/v1/profiles') {
        return json([
          { user_id: 'u-1', full_name: ' Hannah Whitfield ', first_name: null, last_name: null },
          { user_id: 'u-3', full_name: null, first_name: 'Priya', last_name: 'Raman' },
          { user_id: 'u-4', full_name: '', first_name: null, last_name: null },
        ])
      }
      throw new Error(`unexpected ${path}`)
    })
    const names = await listAcceptedTeacherNamesForSessions(['s-1', 's-2'])
    expect(names.get('s-1')).toEqual(['Hannah Whitfield', 'Priya Raman', 'Joanne Pryce'])
    expect(names.has('s-2')).toBe(false)
    const profileCall = fetchMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .find((url) => url.pathname === '/rest/v1/profiles')!
    expect(profileCall.searchParams.get('select')).toBe('user_id,full_name,first_name,last_name')
    expect(profileCall.searchParams.get('user_id')).toBe('in.(u-1,u-3,u-4)')
  })
})
