import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Run-budget regression tests for the post-session report cron. The data
// layer is an in-memory model; the ledger read is capped like PostgREST's
// hosted max_rows and returns rows in insertion/update order, which is how a
// heap scan of a small table orders them.

interface SessionRow {
  id: string
  org_id: string
  department_id: string
  title: string
  date_end: string
  reported: boolean
}

interface DeliveryRow {
  seq: number
  id: string
  session_id: string
  recipient_email: string
  delivery_type: string
  related_id: string
  status: string
  attempt_count: number
}

const db = vi.hoisted(() => ({
  maxRows: 1000,
  seq: 0,
  sessions: [] as SessionRow[],
  attendees: new Map<string, string[]>(),
  certificates: new Map<string, string>(),
  deliveries: [] as DeliveryRow[],
  sends: [] as string[],
}))

vi.mock('@/lib/cron-auth', () => ({ unauthorizedCronResponse: () => null }))
vi.mock('@/lib/webhooks', () => ({ emitWebhook: async () => undefined }))
vi.mock('@/lib/certificates/utils', () => ({ generateCertificateCode: () => 'CODE' }))
vi.mock('@/lib/email-templates', () => ({ buildCertificateEmailHtml: () => '<p>certificate</p>' }))
vi.mock('@/lib/certificates/coordinators', () => ({ resolveTeachingCoordinatorNames: () => [] }))
vi.mock('@/lib/certificates/eligibility', () => ({
  requireCertificateEligibility: async () => ({
    attendanceRevision: 2,
    recognitionBasis: 'LIVE_ATTENDANCE',
  }),
}))
vi.mock('@/lib/email', () => ({
  getFromAddress: () => 'Petrios <no-reply@example.org>',
  getEmailClient: () => ({
    emails: {
      send: async ({ to }: { to: string }) => {
        db.sends.push(to)
        return { data: { id: `msg-${db.sends.length}` }, error: null }
      },
    },
  }),
}))
vi.mock('@/lib/db/sessions', () => ({
  listSessionsNeedingReport: async () =>
    db.sessions
      .filter((session) => !session.reported)
      .sort((a, b) => a.date_end.localeCompare(b.date_end))
      .slice(0, 10),
  markSessionReportSent: async (id: string) => {
    const session = db.sessions.find((candidate) => candidate.id === id)
    if (session) session.reported = true
  },
}))
vi.mock('@/lib/db/attendance', () => ({
  listAttendeeUserIdsByStatusAsSystem: async (sessionId: string) => db.attendees.get(sessionId) ?? [],
  listAttendeeUserIdsBySourceAsSystem: async () => [],
}))
vi.mock('@/lib/db/onboarding', () => ({
  listProfilesForUsers: async (ids: string[]) =>
    ids.map((id) => ({ user_id: id, email: `${id}@example.org`, full_name: id })),
}))
vi.mock('@/lib/db/certificates', () => ({
  listAcceptedRegisteredTeacherIdsAsSystem: async () => [],
  findCertificateCoordinatorNamesAsSystem: async () => ({ coordinator_names: [], lead_name: null }),
  findCertificateByUserAndSession: async (userId: string, sessionId: string) => {
    const id = db.certificates.get(`${sessionId}|${userId}`)
    return id ? { id } : null
  },
  insertCertificateAsSystem: async (input: { sessionId: string; userId: string }) => {
    const id = `current-${input.sessionId}-${input.userId}`
    db.certificates.set(`${input.sessionId}|${input.userId}`, id)
    return { id }
  },
}))
vi.mock('@/lib/db/session-deliveries', () => ({
  listSessionDeliveries: async (input: {
    sessionId: string
    deliveryType: string
    relatedId?: string
    status?: string
  }) =>
    db.deliveries
      .filter(
        (row) =>
          row.session_id === input.sessionId &&
          row.delivery_type === input.deliveryType &&
          (!input.relatedId || row.related_id === input.relatedId) &&
          (!input.status || row.status === input.status)
      )
      .sort((a, b) => a.seq - b.seq)
      .slice(0, db.maxRows),
  getOrCreateSessionDelivery: async (input: {
    sessionId: string
    recipientEmail: string
    deliveryType: string
    relatedId: string
  }) => {
    let row = db.deliveries.find(
      (candidate) =>
        candidate.session_id === input.sessionId &&
        candidate.recipient_email === input.recipientEmail &&
        candidate.delivery_type === input.deliveryType &&
        candidate.related_id === input.relatedId
    )
    if (!row) {
      row = {
        seq: ++db.seq,
        id: `delivery-${db.deliveries.length}`,
        session_id: input.sessionId,
        recipient_email: input.recipientEmail,
        delivery_type: input.deliveryType,
        related_id: input.relatedId,
        status: 'PENDING',
        attempt_count: 0,
      }
      db.deliveries.push(row)
    }
    return { id: row.id, status: row.status, attempt_count: row.attempt_count }
  },
  claimSessionDelivery: async (id: string) => {
    const row = db.deliveries.find((candidate) => candidate.id === id)
    if (!row || (row.status !== 'PENDING' && row.status !== 'FAILED')) return false
    row.status = 'SENDING'
    return true
  },
  recordDeliveryAttempt: async (input: { id: string; success: boolean }) => {
    const row = db.deliveries.find((candidate) => candidate.id === input.id)
    if (!row) return
    row.status = input.success ? 'SENT' : 'FAILED'
    row.attempt_count += 1
    row.seq = ++db.seq
  },
}))

import { GET } from './route'

function addSession(id: string, dateEnd: string, attendeeCount: number) {
  db.sessions.push({
    id,
    org_id: 'org',
    department_id: 'dept',
    title: id,
    date_end: dateEnd,
    reported: false,
  })
  const users = Array.from({ length: attendeeCount }, (_, i) => `${id}-u${String(i).padStart(4, '0')}`)
  db.attendees.set(id, users)
  return users
}

/** Earlier finalized revisions whose certificates were delivered, then revoked by a reopen. */
function addDeliveredEarlierRevisions(sessionId: string, users: string[], revisions: number) {
  for (let revision = 1; revision <= revisions; revision++) {
    for (const user of users) {
      db.deliveries.push({
        seq: ++db.seq,
        id: `old-${revision}-${user}`,
        session_id: sessionId,
        recipient_email: `${user}@example.org`,
        delivery_type: 'ATTENDANCE_CERTIFICATE',
        related_id: `revoked-r${revision}-${user}`,
        status: 'SENT',
        attempt_count: 1,
      })
    }
  }
}

async function runCron() {
  const response = await GET(new NextRequest('http://localhost/api/cron/post-session-reports'))
  return (await response.json()) as {
    processed: number
    deferredSessions: number
    deferredRecipients: number
  }
}

function sendCounts(users: string[]) {
  return users.map((user) => db.sends.filter((to) => to === `${user}@example.org`).length)
}

beforeEach(() => {
  db.seq = 0
  db.sessions = []
  db.attendees = new Map()
  db.certificates = new Map()
  db.deliveries = []
  db.sends = []
})

describe('post-session-reports run budget', () => {
  it('completes a reopened session whose earlier SENT rows fill the capped ledger read', async () => {
    const big = addSession('reopened', '2026-01-01', 400)
    addDeliveredEarlierRevisions('reopened', big, 3)
    const small = addSession('later', '2026-02-01', 2)

    for (let run = 0; run < 3 && db.sessions.some((session) => !session.reported); run++) {
      await runCron()
    }

    expect(db.sessions.every((session) => session.reported)).toBe(true)
    // Every current certificate is emailed exactly once: recipients the capped
    // read missed are recognized as delivered, never re-sent.
    expect(new Set(sendCounts(big))).toEqual(new Set([1]))
    expect(sendCounts(small)).toEqual([1, 1])
  })

  it('never lets a session that cannot finish in one run block the sessions behind it', async () => {
    const big = addSession('large', '2026-01-01', 450)
    const small = addSession('later', '2026-02-01', 2)

    const first = await runCron()
    expect(db.sessions.find((session) => session.id === 'later')?.reported).toBe(true)
    expect(db.sessions.find((session) => session.id === 'large')?.reported).toBe(false)
    expect(first.deferredSessions).toBe(1)
    expect(first.deferredRecipients).toBeGreaterThan(0)
    expect(sendCounts(small)).toEqual([1, 1])

    await runCron()
    expect(db.sessions.every((session) => session.reported)).toBe(true)
    expect(new Set(sendCounts(big))).toEqual(new Set([1]))
  })
})
