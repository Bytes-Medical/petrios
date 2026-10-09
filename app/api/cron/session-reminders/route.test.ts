import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Link wiring for the ~24h session reminder: every recipient's email must
// carry links that recipient can actually use. Registered members get the
// session page; external teachers (no account) get their RSVP page, which is
// where token-protected rooms (JaaS, self-hosted JWT) are joined. The data
// layer is an in-memory model.

const APP = 'https://petrios.example.org'
const SESSION_ID = '5d0c7a8e-1f2b-4c3d-9e8f-a0b1c2d3e4f5'

interface SentEmail {
  to: string
  html: string
}

const db = vi.hoisted(() => ({
  session: null as null | {
    id: string
    org_id: string
    department_id: string
    title: string
    date_start: string
    date_end: string
    location_type: string
    teams_meeting_url: string | null
  },
  memberIds: [] as string[],
  externals: [] as { email: string; first_name: string | null; last_name: string | null; invite_code: string }[],
  sent: [] as SentEmail[],
  reminderMarked: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/cron-auth', () => ({ unauthorizedCronResponse: () => null }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => APP }))
vi.mock('@/lib/email', () => ({
  getFromAddress: () => 'Petrios <no-reply@example.org>',
  getEmailClient: () => ({
    emails: {
      send: async ({ to, html }: { to: string; html: string }) => {
        db.sent.push({ to, html })
        return { data: { id: `msg-${db.sent.length}` }, error: null }
      },
    },
  }),
}))
vi.mock('@/lib/db/sessions', () => ({
  listSessionsNeedingReminder: async () => (db.session ? [db.session] : []),
  listAcceptedSessionTeacherUserIdsAsSystem: async () => [],
  markSessionReminderSent: async (id: string) => {
    db.reminderMarked.push(id)
  },
}))
vi.mock('@/lib/db/departments', () => ({
  listDepartmentMemberUserIds: async () => db.memberIds,
  findDepartmentPublic: async () => ({ name: 'Renal Medicine' }),
}))
vi.mock('@/lib/db/onboarding', () => ({
  listProfilesForUsers: async (ids: string[]) =>
    ids.map((id) => ({ user_id: id, email: `${id}@nhs.example`, full_name: `Dr ${id}` })),
}))
vi.mock('@/lib/db/teacher-invitations', () => ({
  listAcceptedInvitationRecipientsAsSystem: async () => db.externals,
}))
vi.mock('@/lib/db/session-deliveries', () => {
  let seq = 0
  return {
    listSessionDeliveries: async () => [],
    getOrCreateSessionDelivery: async () => ({ id: `delivery-${++seq}`, status: 'PENDING', attempt_count: 0 }),
    claimSessionDelivery: async () => true,
    recordDeliveryAttempt: async () => undefined,
  }
})

import { GET } from './route'

const MEETING_ENV = [
  'JITSI_DOMAIN',
  'NEXT_PUBLIC_JITSI_DOMAIN',
  'JAAS_APP_ID',
  'JAAS_API_KEY_ID',
  'JAAS_PRIVATE_KEY',
  'JITSI_APP_ID',
  'JITSI_APP_SECRET',
  'JITSI_JWT_AUDIENCE',
  'JITSI_JWT_SUBJECT',
] as const

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
const emailTo = (to: string) => {
  const email = db.sent.find((sent) => sent.to === to)
  if (!email) throw new Error(`No reminder sent to ${to}`)
  return email
}

function run() {
  return GET(new NextRequest(`${APP}/api/cron/session-reminders`))
}

beforeEach(() => {
  for (const name of MEETING_ENV) vi.stubEnv(name, '')
  const start = new Date(Date.now() + 20 * 60 * 60 * 1000)
  db.session = {
    id: SESSION_ID,
    org_id: 'org-1',
    department_id: 'dept-1',
    title: 'Hyperkalaemia',
    date_start: start.toISOString(),
    date_end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    location_type: 'JITSI',
    teams_meeting_url: null,
  }
  db.memberIds = ['trainee-1']
  db.externals = [{ email: 'grace@external.example', first_name: 'Grace', last_name: 'Hopper', invite_code: 'Xy7Kp2Qa' }]
  db.sent = []
  db.reminderMarked = []
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('session reminder links', () => {
  it('sends members to the session page and external teachers to their RSVP page when rooms need a pass', async () => {
    vi.stubEnv('JITSI_DOMAIN', 'video.trust.example')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', 'not-a-real-secret')

    const response = await run()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ processed: 1, emailsSent: 2 })

    const member = emailTo('trainee-1@nhs.example')
    expect(new Set(hrefs(member.html))).toEqual(new Set([`${APP}/sessions/${SESSION_ID}`]))

    const external = emailTo('grace@external.example')
    expect(new Set(hrefs(external.html))).toEqual(
      new Set([`${APP}/sessions/${SESSION_ID}/teacher-rsvp/Xy7Kp2Qa`])
    )

    for (const { html } of db.sent) expect(html).not.toContain('video.trust.example')
    expect(db.reminderMarked).toEqual([SESSION_ID])
  })

  it('in public mode mails members the session page (check-in) and externals the meet.jit.si room', async () => {
    await run()
    const sessionPage = `${APP}/sessions/${SESSION_ID}`
    const room = `https://meet.jit.si/Petrios-${SESSION_ID}`
    const member = emailTo('trainee-1@nhs.example').html
    expect(hrefs(member)).toEqual([sessionPage, sessionPage])
    expect(member).not.toContain('meet.jit.si')
    expect(hrefs(emailTo('grace@external.example').html)).toEqual([
      room,
      `${APP}/sessions/${SESSION_ID}/teacher-rsvp/Xy7Kp2Qa`,
    ])
  })

  it('keeps one reminder per address when an external teacher is also a registered member', async () => {
    db.externals = [{ email: 'Trainee-1@NHS.example', first_name: null, last_name: null, invite_code: 'Dup12345' }]
    await run()
    expect(db.sent.map((sent) => sent.to)).toEqual(['trainee-1@nhs.example'])
    expect(db.sent[0].html).not.toContain('teacher-rsvp')
  })
})
