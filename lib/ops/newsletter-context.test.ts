import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpsSessionRow } from '@/lib/db/ops-reads'
import type { OpsNewsletterSourceDocument } from '@/lib/types'

const mocks = vi.hoisted(() => ({
  teacherNames: vi.fn(),
  upcoming: vi.fn(),
  recaps: vi.fn(),
  settings: vi.fn(),
  organizationName: vi.fn(),
}))

vi.mock('@/lib/db/ops-reads', () => ({
  listAcceptedTeacherNamesForSessions: mocks.teacherNames,
  listDepartmentSessionsStartingInWindow: mocks.upcoming,
}))
vi.mock('@/lib/db/audio-recaps', () => ({ listApprovedRecapDurations: mocks.recaps }))
vi.mock('@/lib/db/departments', () => ({ findDepartmentSettings: mocks.settings }))
vi.mock('@/lib/db/organizations', () => ({ findOrganizationName: mocks.organizationName }))
// recap-sources' storage reads are never used by the snapshot loader.
vi.mock('@/lib/db/session-documents', () => ({}))

import { loadNewsletterRenderContext, newsletterUpcomingWindow } from './newsletter-context'
import { NEWSLETTER_UPCOMING_LIMIT, renderNewsletterEmail } from './newsletter-render'
import { sampleNewsletterInput } from './newsletter-render.fixture'
import { buildRecapSourceSnapshot } from './recap-sources'
import { newsletterWindowFromWeekStart } from './newsletter'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const up = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function row(id: string, start: string, end: string, location = 'IN_PERSON', title = 'Session'): OpsSessionRow {
  return {
    id,
    org_id: 'org',
    department_id: 'dept',
    title,
    description: null,
    date_start: start,
    date_end: end,
    location_type: location,
    status: 'PUBLISHED',
    session_type: null,
  }
}

const sessions = [
  row(A, '2026-10-06T11:30:00+00:00', '2026-10-06T13:00:00+00:00'),
  row(B, '2026-10-07T12:00:00+00:00', '2026-10-07T13:00:00+00:00', 'JITSI'),
]

function doc(sessionId: string, id: string, sha = 'a'): OpsNewsletterSourceDocument {
  return {
    sessionId,
    sessionTitle: 'Session',
    id,
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    byteSize: 2048,
    sha256: sha.repeat(64),
  }
}
const docA = doc(A, '55555555-5555-4555-8555-555555555555')
/** The digest an approved recap stores (getCurrentRecapSourceSnapshot). */
const digestOf = (documents: OpsNewsletterSourceDocument[]) => buildRecapSourceSnapshot(documents.map((d) => ({
  id: d.id,
  display_name: d.filename,
  mime_type: 'application/pdf' as const,
  byte_size: d.byteSize,
  sha256: d.sha256,
}))).digest

const load = (overrides: Partial<Parameters<typeof loadNewsletterRenderContext>[0]> = {}) => {
  const now = overrides.now ?? new Date('2026-10-12T09:00:00Z')
  return loadNewsletterRenderContext({
    orgId: 'org',
    departmentId: 'dept',
    departmentName: ' Paediatrics ',
    sessions,
    sourceDocuments: [docA],
    now,
    ...overrides,
    window: overrides.window ?? newsletterWindowFromWeekStart('2026-10-05', now),
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APP_TIME_ZONE', 'Europe/London')
  mocks.organizationName.mockResolvedValue('Example Trust')
  mocks.teacherNames.mockImplementation(async (ids: string[]) => new Map(
    ids.map((id) => [id, id === A ? ['Dr Hannah Whitfield', 'Joanne Pryce'] : ['Dr Priya Raman']])
  ))
  mocks.recaps.mockResolvedValue([
    { session_id: A, audio_duration_seconds: 311.6, source_digest: digestOf([docA]) },
    { session_id: B, audio_duration_seconds: 0, source_digest: digestOf([docA]) },
  ])
  mocks.settings.mockResolvedValue({ leadName: null, coordinatorNames: [' Dr Sarah Lindqvist ', '', 'Dr Femi Adeyemi'], feedbackFormFields: null })
  mocks.upcoming.mockResolvedValue({
    sessions: Array.from({ length: NEWSLETTER_UPCOMING_LIMIT + 1 }, (_, index) =>
      row(up(index + 1), '2026-10-13T11:30:00+00:00', '2026-10-13T11:45:00+00:00', 'HYBRID', `Upcoming ${index + 1}`)),
    total: 10,
  })
})

describe('loadNewsletterRenderContext', () => {
  it('snapshots names, session timing, format, teachers, approved recaps, coordinators and the next week', async () => {
    const context = await load()

    expect(context.version).toBe(1)
    expect(context.snapshotAt).toBe('2026-10-12T09:00:00.000Z')
    expect(context.organizationName).toBe('Example Trust')
    expect(context.departmentName).toBe('Paediatrics')
    expect(context.coordinators).toEqual(['Dr Sarah Lindqvist', 'Dr Femi Adeyemi'])
    expect(context.sessions[A]).toEqual({
      dateStart: '2026-10-06T11:30:00.000Z',
      dateEnd: '2026-10-06T13:00:00.000Z',
      locationType: 'IN_PERSON',
      teachers: ['Dr Hannah Whitfield', 'Joanne Pryce'],
      recap: { durationSeconds: 312 },
    })
    // B has no documents (and a zero-length recap): never shown.
    expect(context.sessions[B].recap).toBeNull()
    // Upcoming window: [max(now, next local Monday 00:00), local midnight 7
    // days after that start's local day), department-scoped, limit + 1.
    expect(mocks.upcoming).toHaveBeenCalledWith(
      'org', 'dept', '2026-10-12T09:00:00.000Z', '2026-10-18T23:00:00.000Z', NEWSLETTER_UPCOMING_LIMIT + 1
    )
    expect(context.upcoming).toMatchObject({ startIso: '2026-10-12T09:00:00.000Z', endIso: '2026-10-18T23:00:00.000Z' })
    expect(context.upcoming.sessions).toHaveLength(NEWSLETTER_UPCOMING_LIMIT)
    expect(context.upcoming.more).toBe(10 - NEWSLETTER_UPCOMING_LIMIT)
    expect(context.upcoming.sessions[0]).toMatchObject({ id: up(1), title: 'Upcoming 1', dateEnd: '2026-10-13T11:45:00.000Z' })
    // Teacher names for the upcoming rows come from a second batched read.
    expect(mocks.teacherNames).toHaveBeenLastCalledWith(context.upcoming.sessions.map((session) => session.id))
    expect(mocks.settings).toHaveBeenCalledWith('dept', 'org')
    expect(mocks.organizationName).toHaveBeenCalledWith('org')
  })

  it('falls back to Petrios when the organisation has no name', async () => {
    mocks.organizationName.mockResolvedValue(null)
    expect((await load()).organizationName).toBe('Petrios')
  })

  it('omits an approved recap whose source documents changed, as the session page does', async () => {
    mocks.recaps.mockResolvedValue([
      { session_id: A, audio_duration_seconds: 300, source_digest: digestOf([doc(A, docA.id, 'b')]) },
    ])
    expect((await load()).sessions[A].recap).toBeNull()
    // Same digest, but the session's documents were all removed.
    mocks.recaps.mockResolvedValue([{ session_id: A, audio_duration_seconds: 300, source_digest: digestOf([docA]) }])
    expect((await load({ sourceDocuments: [] })).sessions[A].recap).toBeNull()
    // No stored digest is never current.
    mocks.recaps.mockResolvedValue([{ session_id: A, audio_duration_seconds: 300, source_digest: null }])
    expect((await load()).sessions[A].recap).toBeNull()
    // Another session's documents do not count towards A's digest.
    mocks.recaps.mockResolvedValue([{ session_id: A, audio_duration_seconds: 300, source_digest: digestOf([docA]) }])
    expect((await load({ sourceDocuments: [docA, doc(B, '66666666-6666-4666-8666-666666666666')] })).sessions[A].recap)
      .toEqual({ durationSeconds: 300 })
  })

  it('never shows past teaching for an old week drafted late', async () => {
    const now = new Date('2026-10-20T08:00:00Z')
    await load({ now, window: newsletterWindowFromWeekStart('2026-10-05', now) })
    expect(mocks.upcoming.mock.calls[0][2]).toBe('2026-10-20T08:00:00.000Z')
    // Seven local calendar days from Tuesday 20 Oct: to Monday 26 Oct 23:59 GMT.
    expect(mocks.upcoming.mock.calls[0][3]).toBe('2026-10-27T00:00:00.000Z')
  })

  it('anchors the upcoming week to local midnights in BST, GMT and across the clock change', () => {
    const at = (weekStart: string, now: string) => {
      const window = newsletterUpcomingWindow(newsletterWindowFromWeekStart(weekStart, new Date(now)).weekEnd, new Date(now))
      return [window.start.toISOString(), window.end.toISOString()]
    }
    // Drafted mid-week for the current week (BST): next Monday 00:00 BST.
    expect(at('2026-10-05', '2026-10-07T10:00:00Z')).toEqual(['2026-10-11T23:00:00.000Z', '2026-10-18T23:00:00.000Z'])
    // GMT.
    expect(at('2026-11-02', '2026-11-04T10:00:00Z')).toEqual(['2026-11-09T00:00:00.000Z', '2026-11-16T00:00:00.000Z'])
    // The upcoming week contains the BST → GMT change (Sunday 25 Oct 2026).
    expect(at('2026-10-12', '2026-10-14T10:00:00Z')).toEqual(['2026-10-18T23:00:00.000Z', '2026-10-26T00:00:00.000Z'])
  })

  it('renders the loader’s real window as a seven-day "Coming up" range', async () => {
    const label = async (weekStart: string, now: string) => {
      const at = new Date(now)
      const context = await load({ now: at, window: newsletterWindowFromWeekStart(weekStart, at) })
      const input = sampleNewsletterInput()
      input.render.upcoming = context.upcoming
      const { html, text } = renderNewsletterEmail(input)
      const match = text.match(/COMING UP · (.+)/)?.[1]
      expect(html).toContain(match)
      return match
    }
    expect(await label('2026-10-05', '2026-10-07T10:00:00Z')).toBe('12–18 OCT') // BST, the approved mockup
    expect(await label('2026-10-05', '2026-10-12T09:00:00Z')).toBe('12–18 OCT')
    expect(await label('2026-11-02', '2026-11-04T10:00:00Z')).toBe('9–15 NOV') // GMT
    expect(await label('2026-10-12', '2026-10-14T10:00:00Z')).toBe('19–25 OCT') // clock change
    expect(await label('2026-08-31', '2026-09-02T10:00:00Z')).toBe('7–13 SEP') // never "SEPT"
  })

  it('clips teacher names and caps the list instead of failing validation', async () => {
    mocks.teacherNames.mockResolvedValue(new Map([[A, Array.from({ length: 10 }, (_, index) => `${index}${'x'.repeat(200)}`)]]))
    const context = await load()
    expect(context.sessions[A].teachers).toHaveLength(8)
    expect(context.sessions[A].teachers.every((name) => name.length <= 120)).toBe(true)
    expect(context.sessions[B].teachers).toEqual([])
  })

  it('rejects an unknown location type', async () => {
    await expect(load({
      sessions: [row(A, '2026-10-06T11:30:00Z', '2026-10-06T13:00:00Z', 'ZOOM')],
    })).rejects.toThrow('location type')
  })
})
