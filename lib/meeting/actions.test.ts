import { createHmac, generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Server actions are tested from lib/ because vitest only collects lib/**
// (and cron) tests. The data-access layer, auth helpers and the existing
// checkIn action are mocked; configuration, claims and signing are real.

const state = vi.hoisted(() => ({
  userId: 'user-1' as string | null,
  orgId: 'org-1' as string | null,
  departmentModerator: false,
  session: null as Record<string, unknown> | null,
  teacher: null as { status: string } | null,
  profile: { full_name: 'Ada Lovelace', email: 'ada@nhs.example' } as Record<string, unknown> | null,
  invitation: null as Record<string, unknown> | null,
  invitedSession: null as Record<string, unknown> | null,
  checkIn: vi.fn(),
  findSession: vi.fn(),
  findSessionTeacher: vi.fn(),
  isDepartmentModerator: vi.fn(),
  findInvitation: vi.fn(),
  findInvitedSession: vi.fn(),
  hasCheckInEvidence: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://petrios.example' }))
vi.mock('@/lib/auth', () => ({
  getCurrentUserId: async () => state.userId,
  getCurrentOrgId: async () => state.orgId,
  isDepartmentModerator: (departmentId: string) => state.isDepartmentModerator(departmentId),
}))
vi.mock('@/lib/db/sessions', () => ({
  findSession: (id: string, orgId: string) => state.findSession(id, orgId),
  findSessionTeacher: (sessionId: string, userId: string, orgId: string) =>
    state.findSessionTeacher(sessionId, userId, orgId),
  findSessionForInvitationAsSystem: (input: unknown) => state.findInvitedSession(input),
}))
vi.mock('@/lib/db/onboarding', () => ({ findProfileByUserId: async () => state.profile }))
vi.mock('@/lib/db/teacher-invitations', () => ({
  findInvitationByCodeAndSession: (input: unknown) => state.findInvitation(input),
}))
vi.mock('@/lib/db/attendance', () => ({
  userHasCheckInEvidence: (input: unknown) => state.hasCheckInEvidence(input),
}))
vi.mock('@/app/actions/attendance', () => ({ checkIn: (sessionId: string) => state.checkIn(sessionId) }))

import {
  checkInFromMeeting,
  getExternalTeacherMeetingJoin,
  getMeetingJoin,
  reportMeetingConnectError,
} from '@/app/actions/meetings'
import { resetInviteCodeCapabilityWarningForTests } from '@/lib/teacher-invitation-capability'
import { resetMeetingConfigForTests } from './config'
import type { MeetingJoinResult } from './types'

const SESSION_ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
const OTHER_SESSION_ID = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const APP_ID = 'vpaas-magic-cookie-0123456789abcdef'
const KEY_ID = `${APP_ID}/4f4910`
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const SPKI = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }))
const SECRET = 'prosody-shared-secret'

// Session 12:00–13:00 UTC → room 11:30–13:30; check-in 11:45–12:45.
const DURING = new Date('2026-10-09T12:10:00.000Z')
const SESSION = {
  id: SESSION_ID,
  org_id: 'org-1',
  department_id: 'dept-1',
  title: 'Acute kidney injury',
  status: 'PUBLISHED',
  location_type: 'JITSI',
  teams_meeting_url: null,
  date_start: '2026-10-09T12:00:00.000Z',
  date_end: '2026-10-09T13:00:00.000Z',
  attendance_phase: 'OPEN',
  attendance_locked: false,
}
const INVITATION = {
  id: 'invitation-1',
  org_id: 'org-1',
  session_id: SESSION_ID,
  email: 'grace@external.example',
  first_name: 'Grace',
  last_name: 'Hopper',
  invite_code: 'AB7KQ9ZX',
  status: 'ACCEPTED',
}

const MEETING_VARS = [
  'JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', 'JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY',
  'JITSI_APP_ID', 'JITSI_APP_SECRET', 'JITSI_JWT_AUDIENCE', 'JITSI_JWT_SUBJECT',
]

function useJaas() {
  vi.stubEnv('JAAS_APP_ID', APP_ID)
  vi.stubEnv('JAAS_API_KEY_ID', KEY_ID)
  vi.stubEnv('JAAS_PRIVATE_KEY', PRIVATE_PEM.trim().replace(/\n/g, '\\n'))
}

function decode(token: string) {
  const [header, payload] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      room: string
      exp: number
      nbf: number
      iat: number
      sub: string
      iss: string
      aud: string
      context: { user: Record<string, unknown>; features: Record<string, unknown> }
    },
  }
}

async function verifiesWithPublicKey(token: string): Promise<boolean> {
  const [header, payload, signature] = token.split('.')
  const key = await crypto.subtle.importKey('spki', SPKI, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    new Uint8Array(Buffer.from(signature, 'base64url')),
    new TextEncoder().encode(`${header}.${payload}`)
  )
}

function joined(result: MeetingJoinResult) {
  if (!result.ok) throw new Error(`expected a join, got ${result.reason}: ${result.message}`)
  return result.join
}

function denied(result: MeetingJoinResult) {
  if (result.ok) throw new Error('expected a denial')
  return result
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DURING)
  for (const name of MEETING_VARS) vi.stubEnv(name, '')
  // The operator has applied the teacher_invitations policy fix (spec/13).
  vi.stubEnv('TEACHER_INVITATIONS_RLS_LOCKED', 'true')
  resetMeetingConfigForTests()
  resetInviteCodeCapabilityWarningForTests()
  state.userId = 'user-1'
  state.orgId = 'org-1'
  state.departmentModerator = false
  state.session = { ...SESSION }
  state.teacher = null
  state.profile = { full_name: 'Ada Lovelace', email: 'ada@nhs.example' }
  state.invitation = { ...INVITATION }
  state.invitedSession = { ...SESSION }
  state.checkIn.mockReset().mockResolvedValue({ success: true })
  state.hasCheckInEvidence.mockReset().mockResolvedValue(false)
  state.findSession.mockReset().mockImplementation(async (id: string, orgId: string) =>
    state.session && state.session.id === id && state.session.org_id === orgId ? state.session : null
  )
  state.findSessionTeacher.mockReset().mockImplementation(async () => state.teacher)
  state.isDepartmentModerator.mockReset().mockImplementation(async () => state.departmentModerator)
  state.findInvitation.mockReset().mockImplementation(async (input: { inviteCode: string; sessionId: string }) =>
    state.invitation &&
    state.invitation.invite_code === input.inviteCode &&
    state.invitation.session_id === input.sessionId
      ? state.invitation
      : null
  )
  state.findInvitedSession.mockReset().mockImplementation(async (input: { sessionId: string; orgId: string }) =>
    state.invitedSession && state.invitedSession.id === input.sessionId && state.invitedSession.org_id === input.orgId
      ? state.invitedSession
      : null
  )
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('getMeetingJoin (signed-in members)', () => {
  it('gives an org member a JaaS participant pass for that one room', async () => {
    useJaas()
    const join = joined(await getMeetingJoin(SESSION_ID))
    expect(join).toMatchObject({
      domain: '8x8.vc',
      roomName: `${APP_ID}/Petrios-${SESSION_ID}`,
      moderator: false,
      displayName: 'Ada Lovelace',
    })
    const token = join.jwt as string
    expect(await verifiesWithPublicKey(token)).toBe(true)
    const { header, payload } = decode(token)
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: KEY_ID })
    expect(payload).toMatchObject({ aud: 'jitsi', iss: 'chat', sub: APP_ID, room: `petrios-${SESSION_ID}` })
    expect(payload.context.user).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Ada Lovelace', moderator: 'false' })
    expect(payload.context.user.id).not.toContain('user-1')
    expect(token).not.toContain('ada@nhs.example')
    expect(JSON.stringify(payload)).not.toMatch(/email|@/)
    // Expiry: the room close (13:30) is under four hours away.
    expect(payload.exp).toBe(Date.parse('2026-10-09T13:30:00.000Z') / 1000)
    expect(payload.nbf).toBe(DURING.getTime() / 1000 - 30)
    expect(join.expiresAt).toBe('2026-10-09T13:30:00.000Z')
    expect(state.findSession).toHaveBeenCalledWith(SESSION_ID, 'org-1')
  })

  it('makes a department moderator (incl. org/super admin) a JaaS moderator', async () => {
    useJaas()
    state.departmentModerator = true
    const join = joined(await getMeetingJoin(SESSION_ID))
    expect(join.moderator).toBe(true)
    expect(decode(join.jwt as string).payload.context.user.moderator).toBe('true')
    expect(state.isDepartmentModerator).toHaveBeenCalledWith('dept-1')
  })

  it('makes an ACCEPTED assigned teacher a moderator', async () => {
    useJaas()
    state.teacher = { status: 'ACCEPTED' }
    const join = joined(await getMeetingJoin(SESSION_ID))
    expect(decode(join.jwt as string).payload.context.user.moderator).toBe('true')
    expect(state.findSessionTeacher).toHaveBeenCalledWith(SESSION_ID, 'user-1', 'org-1')
  })

  it.each(['PENDING', 'DECLINED'])('keeps a %s teacher a participant', async (status) => {
    useJaas()
    state.teacher = { status }
    const join = joined(await getMeetingJoin(SESSION_ID))
    expect(join.moderator).toBe(false)
    expect(decode(join.jwt as string).payload.context.user.moderator).toBe('false')
  })

  it('uses "Attendee", never the email, when the profile has no name', async () => {
    useJaas()
    state.profile = { full_name: null, first_name: null, last_name: null, email: 'nameless@nhs.example' }
    const join = joined(await getMeetingJoin(SESSION_ID))
    expect(join.displayName).toBe('Attendee')
    expect(join.jwt).not.toContain('nameless')
  })

  it('caps the pass at four hours for a long session', async () => {
    useJaas()
    state.session = { ...SESSION, date_end: '2026-10-09T20:00:00.000Z' }
    const { payload } = decode(joined(await getMeetingJoin(SESSION_ID)).jwt as string)
    expect(payload.exp - payload.iat).toBe(4 * 60 * 60)
  })

  it('mints a fresh pass on every call (rejoin after expiry)', async () => {
    useJaas()
    const first = joined(await getMeetingJoin(SESSION_ID))
    vi.setSystemTime(new Date(DURING.getTime() + 60_000))
    const second = joined(await getMeetingJoin(SESSION_ID))
    expect(second.jwt).not.toBe(first.jwt)
    expect(decode(second.jwt as string).payload.iat).toBe(decode(first.jwt as string).payload.iat + 60)
    expect(decode(second.jwt as string).payload.context.user.id).toBe(decode(first.jwt as string).payload.context.user.id)
  })

  it('denies a signed-out caller', async () => {
    useJaas()
    state.userId = null
    expect(denied(await getMeetingJoin(SESSION_ID)).reason).toBe('not_signed_in')
    expect(state.findSession).not.toHaveBeenCalled()
  })

  it('denies a malformed session id without touching the database', async () => {
    useJaas()
    expect(denied(await getMeetingJoin('not-a-uuid')).reason).toBe('not_found')
    expect(state.findSession).not.toHaveBeenCalled()
  })

  it('denies a session the caller cannot read (RLS / other org) as not_found', async () => {
    useJaas()
    state.session = { ...SESSION, org_id: 'org-2' }
    expect(denied(await getMeetingJoin(SESSION_ID)).reason).toBe('not_found')
    state.orgId = null
    expect(denied(await getMeetingJoin(SESSION_ID)).reason).toBe('not_found')
  })

  it.each([
    [{ status: 'DRAFT' }, 'not_published'],
    [{ status: 'CANCELLED' }, 'cancelled'],
    [{ location_type: 'MS_TEAMS' }, 'not_video'],
  ])('denies %j as %s, even for moderators', async (patch, reason) => {
    useJaas()
    state.departmentModerator = true
    state.session = { ...SESSION, ...patch }
    expect(denied(await getMeetingJoin(SESSION_ID)).reason).toBe(reason)
  })

  it('denies before the room opens with the open time, and after it closes', async () => {
    useJaas()
    vi.setSystemTime(new Date('2026-10-09T11:29:00.000Z'))
    expect(denied(await getMeetingJoin(SESSION_ID))).toMatchObject({
      reason: 'too_early', retryable: true, opensAt: '2026-10-09T11:30:00.000Z',
    })
    vi.setSystemTime(new Date('2026-10-09T13:30:01.000Z'))
    expect(denied(await getMeetingJoin(SESSION_ID))).toMatchObject({ reason: 'ended', retryable: false })
    expect(state.isDepartmentModerator).not.toHaveBeenCalled()
  })

  it('says ended (not a retryable error, nothing logged) exactly at the room close', async () => {
    // The window is inclusive, but a pass must expire after it is issued:
    // without the guard this would be a logged, retryable 'unavailable'.
    useJaas()
    vi.setSystemTime(new Date('2026-10-09T13:30:00.000Z'))
    expect(denied(await getMeetingJoin(SESSION_ID))).toMatchObject({ reason: 'ended', retryable: false })
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each(['2026-10-09T13:29:59.000Z', '2026-10-09T13:29:59.500Z'])(
    'still mints a pass at %s, expiring exactly at the close',
    async (at) => {
      useJaas()
      vi.setSystemTime(new Date(at))
      const join = joined(await getMeetingJoin(SESSION_ID))
      expect(join.expiresAt).toBe('2026-10-09T13:30:00.000Z')
      expect(decode(join.jwt as string).payload.exp).toBe(Date.parse('2026-10-09T13:30:00.000Z') / 1000)
    }
  )

  it('says not_embedded in public (meet.jit.si) mode', async () => {
    expect(denied(await getMeetingJoin(SESSION_ID))).toMatchObject({
      reason: 'not_embedded', message: 'Video rooms on this site open on meet.jit.si in a new tab.',
    })
  })

  it('returns unavailable (retryable, no throw) for partial JaaS, logging only variable names', async () => {
    vi.stubEnv('JAAS_APP_ID', APP_ID)
    vi.stubEnv('JAAS_PRIVATE_KEY', PRIVATE_PEM)
    const result = denied(await getMeetingJoin(SESSION_ID))
    expect(result).toMatchObject({ reason: 'unavailable', retryable: true })
    expect(result.message).not.toContain('JAAS')
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ')
    expect(logged).toContain('JAAS_API_KEY_ID')
    expect(logged).not.toContain('PRIVATE KEY')
    expect(logged).not.toContain('MII')
  })

  it('returns unavailable when the key passes the shape check but cannot be imported', async () => {
    useJaas()
    const subtle = globalThis.crypto.subtle
    vi.spyOn(subtle, 'importKey').mockRejectedValue(new Error('unsupported'))
    // A key not imported by earlier tests (the import cache is keyed on the canonical PEM).
    const fresh = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    vi.stubEnv('JAAS_PRIVATE_KEY', fresh.export({ type: 'pkcs8', format: 'pem' }).toString())
    const result = denied(await getMeetingJoin(SESSION_ID))
    expect(result.reason).toBe('unavailable')
  })

  it('returns unavailable (no throw) when the database fails', async () => {
    useJaas()
    state.findSession.mockRejectedValue(new Error('connection reset'))
    expect(denied(await getMeetingJoin(SESSION_ID))).toMatchObject({ reason: 'unavailable', retryable: true })
  })

  it('joins an open self-hosted room without a pass', async () => {
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org')
    expect(joined(await getMeetingJoin(SESSION_ID))).toEqual({
      domain: 'meet.example.org',
      roomName: `Petrios-${SESSION_ID}`,
      jwt: null,
      expiresAt: null,
      moderator: false,
      displayName: 'Ada Lovelace',
    })
  })

  it('signs self-hosted HS256 passes that verify with the shared secret', async () => {
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org:8443')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    vi.stubEnv('JITSI_APP_SECRET', SECRET)
    state.departmentModerator = true
    const join = joined(await getMeetingJoin(SESSION_ID))
    expect(join).toMatchObject({ domain: 'meet.example.org:8443', roomName: `Petrios-${SESSION_ID}`, moderator: true })
    const [h, p, s] = (join.jwt as string).split('.')
    expect(s).toBe(createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'))
    const { header, payload } = decode(join.jwt as string)
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(payload).toMatchObject({
      iss: 'petrios', aud: 'jitsi', sub: 'meet.example.org', room: `petrios-${SESSION_ID}`,
      context: { user: { name: 'Ada Lovelace', moderator: 'true' } },
    })
    expect(join.jwt).not.toContain(SECRET)
  })
})

describe('getExternalTeacherMeetingJoin (accepted invitation as capability)', () => {
  it('gives the accepted teacher a moderator pass named from the invitation, never the email', async () => {
    useJaas()
    const join = joined(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX'))
    expect(join).toMatchObject({ moderator: true, displayName: 'Grace Hopper', roomName: `${APP_ID}/Petrios-${SESSION_ID}` })
    const token = join.jwt as string
    expect(await verifiesWithPublicKey(token)).toBe(true)
    const { payload } = decode(token)
    expect(payload.context.user).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Grace Hopper', moderator: 'true' })
    expect(payload.room).toBe(`petrios-${SESSION_ID}`)
    expect(payload.exp).toBeLessThanOrEqual(Date.parse('2026-10-09T13:30:00.000Z') / 1000)
    expect(JSON.stringify(payload)).not.toMatch(/grace@|external\.example|email/)
    expect(state.findInvitedSession).toHaveBeenCalledWith({ sessionId: SESSION_ID, orgId: 'org-1' })
  })

  it('falls back to "Guest teacher" when the invitation has no names', async () => {
    useJaas()
    state.invitation = { ...INVITATION, first_name: null, last_name: '  ' }
    expect(joined(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).displayName).toBe('Guest teacher')
  })

  it.each([
    ['a malformed code', SESSION_ID, 'bad code!'],
    ['a malformed session id', 'nope', 'AB7KQ9ZX'],
    ['an unknown code', SESSION_ID, 'ZZZZZZZZ'],
    ['a code for a different session', OTHER_SESSION_ID, 'AB7KQ9ZX'],
  ])('rejects %s as invalid_invitation', async (_label, sessionId, code) => {
    useJaas()
    expect(denied(await getExternalTeacherMeetingJoin(sessionId, code))).toMatchObject({
      reason: 'invalid_invitation', message: 'This invitation link is invalid or has expired.',
    })
    expect(state.findInvitedSession).not.toHaveBeenCalled()
  })

  it.each(['PENDING', 'DECLINED'])('rejects a %s invitation as not_accepted', async (status) => {
    useJaas()
    state.invitation = { ...INVITATION, status }
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('not_accepted')
    expect(state.findInvitedSession).not.toHaveBeenCalled()
  })

  it('rejects a missing session or an organization mismatch as not_found', async () => {
    useJaas()
    state.invitedSession = null
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('not_found')
    state.invitedSession = { ...SESSION, org_id: 'org-2' }
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('not_found')
  })

  it('enforces the room window and the session status', async () => {
    useJaas()
    vi.setSystemTime(new Date('2026-10-09T11:00:00.000Z'))
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX'))).toMatchObject({
      reason: 'too_early', opensAt: '2026-10-09T11:30:00.000Z',
    })
    vi.setSystemTime(new Date('2026-10-09T14:00:00.000Z'))
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('ended')
    vi.setSystemTime(DURING)
    state.invitedSession = { ...SESSION, status: 'CANCELLED' }
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('cancelled')
  })

  it('says ended (nothing logged) exactly at the room close', async () => {
    useJaas()
    vi.setSystemTime(new Date('2026-10-09T13:30:00.000Z'))
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX'))).toMatchObject({
      reason: 'ended', retryable: false,
    })
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'false', 'TRUE'])(
    'mints nothing while TEACHER_INVITATIONS_RLS_LOCKED is %j (invite codes are world-readable until the fix)',
    async (value) => {
      useJaas()
      vi.stubEnv('TEACHER_INVITATIONS_RLS_LOCKED', value as string)
      const result = denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX'))
      expect(result).toMatchObject({ reason: 'unavailable', retryable: false })
      // Not even a lookup: the code is not trusted as a capability.
      expect(state.findInvitation).not.toHaveBeenCalled()
      expect(state.findInvitedSession).not.toHaveBeenCalled()
      expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).toContain('TEACHER_INVITATIONS_RLS_LOCKED')
    }
  )

  it('says not_embedded in public mode and unavailable on a configuration error', async () => {
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('not_embedded')
    vi.stubEnv('JITSI_DOMAIN', 'meet.example.org')
    vi.stubEnv('JITSI_APP_ID', 'petrios')
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('unavailable')
  })

  it('returns unavailable (no throw) when the invitation lookup fails', async () => {
    useJaas()
    state.findInvitation.mockRejectedValue(new Error('timeout'))
    expect(denied(await getExternalTeacherMeetingJoin(SESSION_ID, 'AB7KQ9ZX')).reason).toBe('unavailable')
  })
})

describe('checkInFromMeeting (wraps the existing self check-in)', () => {
  it('records the check-in inside the window and says so', async () => {
    const result = await checkInFromMeeting(SESSION_ID)
    expect(result).toEqual({
      ok: true,
      message: "You're checked in. Your attendance stays provisional until the moderator finalizes it.",
    })
    expect(state.checkIn).toHaveBeenCalledWith(SESSION_ID)
  })

  it('says "already checked in" (and appends nothing) when the member already used the session code', async () => {
    state.hasCheckInEvidence.mockResolvedValue(true)
    // Even with an active session code, which would otherwise block self check-in.
    state.checkIn.mockRejectedValue(new Error('An active session code is required for check-in'))
    expect(await checkInFromMeeting(SESSION_ID)).toEqual({
      ok: true,
      message: "You're already checked in for this session. Your attendance stays provisional until the moderator finalizes it.",
    })
    expect(state.hasCheckInEvidence).toHaveBeenCalledWith({ orgId: 'org-1', sessionId: SESSION_ID, userId: 'user-1' })
    expect(state.checkIn).not.toHaveBeenCalled()
  })

  it('reports an existing check-in even outside the self check-in window', async () => {
    state.hasCheckInEvidence.mockResolvedValue(true)
    vi.setSystemTime(new Date('2026-10-09T12:50:00.000Z'))
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ ok: true, message: expect.stringContaining('already checked in') })
  })

  it('reports finalized attendance without calling checkIn', async () => {
    state.session = { ...SESSION, attendance_phase: 'FINALIZED' }
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ ok: false, reason: 'finalized' })
    state.session = { ...SESSION, attendance_locked: true }
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ ok: false, reason: 'finalized' })
    expect(state.checkIn).not.toHaveBeenCalled()
  })

  it('reports a not-yet-open check-in window with its times (the room window does not widen it)', async () => {
    vi.setSystemTime(new Date('2026-10-09T11:35:00.000Z')) // room open, check-in opens 11:45
    expect(await checkInFromMeeting(SESSION_ID)).toEqual({
      ok: false,
      reason: 'outside_window',
      message: 'Check-in for this session has not opened yet.',
      window: { opensAt: '2026-10-09T11:45:00.000Z', closesAt: '2026-10-09T12:45:00.000Z' },
    })
    expect(state.checkIn).not.toHaveBeenCalled()
  })

  it('reports a closed check-in window, honouring per-session overrides', async () => {
    vi.setSystemTime(new Date('2026-10-09T12:50:00.000Z'))
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({
      reason: 'outside_window',
      message: 'The check-in window has closed. A moderator can correct attendance during review.',
    })
    state.session = { ...SESSION, checkin_close_mins_after: 60 }
    expect(await checkInFromMeeting(SESSION_ID)).toEqual({
      ok: true, message: expect.stringContaining("You're checked in"),
    })
  })

  it('maps an active session code to code_required', async () => {
    state.checkIn.mockRejectedValue(new Error('An active session code is required for check-in'))
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({
      ok: false, reason: 'code_required', message: expect.stringContaining('session code'),
    })
  })

  it('maps the RPC finalized and window errors from a race', async () => {
    state.checkIn.mockRejectedValueOnce(new Error('Failed to record attendance evidence: Attendance is finalized'))
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ reason: 'finalized' })
    state.checkIn.mockRejectedValueOnce(new Error('Time window closed for SELF_CHECKIN evidence'))
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({
      reason: 'outside_window', window: { opensAt: '2026-10-09T11:45:00.000Z', closesAt: '2026-10-09T12:45:00.000Z' },
    })
  })

  it('returns failed without throwing on an unexpected error', async () => {
    state.checkIn.mockRejectedValue(new Error('boom'))
    expect(await checkInFromMeeting(SESSION_ID)).toEqual({
      ok: false, reason: 'failed', message: "We couldn't record your check-in. Use the Check in panel on this page.",
    })
  })

  it('requires a signed-in member and a readable, published video session', async () => {
    state.userId = null
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ reason: 'not_signed_in' })
    state.userId = 'user-1'
    state.session = null
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ reason: 'not_available' })
    state.session = { ...SESSION, status: 'DRAFT' }
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ reason: 'not_available' })
    state.session = { ...SESSION, location_type: 'IN_PERSON' }
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ reason: 'not_available' })
    expect(await checkInFromMeeting('bad-id')).toMatchObject({ reason: 'not_available' })
    expect(state.checkIn).not.toHaveBeenCalled()
  })

  it('works the same in every meeting mode (check-in does not depend on the backend)', async () => {
    vi.stubEnv('JAAS_APP_ID', APP_ID) // even a configuration error
    expect(await checkInFromMeeting(SESSION_ID)).toMatchObject({ ok: true })
  })
})

describe('reportMeetingConnectError (operator signal for a refused room pass)', () => {
  it('logs the provider error name, mode and session id for embedded modes', async () => {
    useJaas()
    await reportMeetingConnectError(SESSION_ID, 'conference.connectionError.notAllowed')
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ')
    expect(logged).toContain('[petrios-meet]')
    expect(logged).toContain('jaas')
    expect(logged).toContain(SESSION_ID)
    expect(logged).toContain('conference.connectionError.notAllowed')
  })

  it.each([
    ['a non-identifier name', SESSION_ID, 'eyJhbGciOi.payload sig <script>'],
    ['an over-long name', SESSION_ID, 'x'.repeat(81)],
    ['a malformed session id', 'nope', 'connection.otherError'],
  ])('drops %s without logging', async (_label, sessionId, name) => {
    useJaas()
    await reportMeetingConnectError(sessionId, name)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs nothing in public mode (nothing is embedded there)', async () => {
    await reportMeetingConnectError(SESSION_ID, 'connection.otherError')
    expect(console.error).not.toHaveBeenCalled()
  })
})
