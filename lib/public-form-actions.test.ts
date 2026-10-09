import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DbConflictError, DbError } from '@/lib/db'

// The public feedback, teacher-RSVP and slot-claim server actions must RETURN
// their expected failures: Next.js masks thrown action errors in production,
// so a thrown message never reaches the visitor. Lives under lib/ because
// vitest only collects lib/** (and cron) tests.

const state = vi.hoisted(() => ({
  session: null as Record<string, unknown> | null,
  department: null as Record<string, unknown> | null,
  insertFeedback: vi.fn(),
  invitation: null as Record<string, unknown> | null,
  updateInvitation: vi.fn(),
  claimLink: null as Record<string, unknown> | null,
  slot: null as Record<string, unknown> | null,
  offered: true,
  claimSlot: vi.fn(),
  insertSession: vi.fn(),
  revertClaim: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/server', () => ({ after: () => undefined }))
vi.mock('@/lib/auth', () => ({
  requireAuth: async () => 'user-1',
  requireOrg: async () => 'org-1',
}))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://petrios.example' }))
vi.mock('@/lib/email', () => ({}))
vi.mock('@/lib/ai/llm', () => ({}))
vi.mock('@/lib/ai/feedback-summary', () => ({}))
vi.mock('@/lib/notify', () => ({ notifyUser: async () => undefined }))
vi.mock('@/lib/webhooks', () => ({ emitWebhook: async () => undefined }))
vi.mock('@/lib/db/feedback', () => ({
  findSessionForFeedbackSubmission: async () => state.session,
  findDepartmentForFeedbackSubmission: async () => state.department,
  insertSessionFeedback: (input: unknown) => state.insertFeedback(input),
}))
vi.mock('@/lib/db/onboarding', () => ({
  findProfileByEmail: async () => null,
  findProfileByUserId: async () => null,
}))
vi.mock('@/lib/db/sessions', () => ({}))
vi.mock('@/lib/db/feedback-reports', () => ({}))
vi.mock('@/lib/db/session-deliveries', () => ({}))
vi.mock('@/lib/db/departments', () => ({}))
vi.mock('@/lib/db/notifications', () => ({}))
vi.mock('@/lib/db/teacher-emails', () => ({}))
vi.mock('@/lib/db/teacher-invitations', () => ({
  findInvitationByCode: async () => state.invitation,
  updateInvitationResponse: (input: unknown) => state.updateInvitation(input),
  findDepartmentName: async () => 'Medicine',
}))
vi.mock('@/lib/db/external-contacts', () => ({
  upsertContactByEmail: async (input: { firstName: string; lastName: string; email: string }) => ({
    id: 'contact-1',
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
  }),
}))
vi.mock('@/lib/db/teaching-slots', () => ({
  findClaimLinkByCode: async () => state.claimLink,
  findSlot: async () => state.slot,
  findSlotAsSystem: async () => state.slot,
  hasClaimLinkForSlot: async () => state.offered,
  claimSlot: (input: unknown) => state.claimSlot(input),
  insertClaimedSessionAsSystem: (input: unknown) => state.insertSession(input),
  insertAcceptedExternalInvitationAsSystem: async () => undefined,
  insertAcceptedSessionTeacherAsSystem: async () => undefined,
  linkSlotSession: async () => undefined,
  revertClaim: (id: string) => state.revertClaim(id),
}))

import { submitFeedback } from '@/app/actions/feedback'
import { respondToInvitation } from '@/app/actions/teacher-invitations'
import { claimSlotAsMember, claimSlotByCode } from '@/app/actions/teaching-slots'

const NOW = new Date('2026-10-09T10:30:00.000Z')

const identity = { firstName: ' Ada ', lastName: 'Lovelace', email: ' Ada@Example.org ', answers: [] }

const slotRow = {
  id: 'slot-1',
  org_id: 'org-1',
  department_id: 'dept-1',
  date_start: '2026-11-01T10:00:00.000Z',
  date_end: '2026-11-01T11:00:00.000Z',
  location_type: 'IN_PERSON',
  status: 'OPEN',
  session_id: null,
  claimed_by_user_id: null,
  claimed_by_contact_id: null,
  created_by: 'moderator-1',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  state.session = {
    id: 'session-1',
    org_id: 'org-1',
    department_id: 'dept-1',
    title: 'Grand round',
    status: 'PUBLISHED',
    date_start: '2026-10-09T10:00:00.000Z',
    date_end: '2026-10-09T11:00:00.000Z',
    checkin_open_mins_before: null,
    feedback_valid_mins_after_end: null,
  }
  state.department = {
    name: 'Medicine',
    lead_name: null,
    feedback_form_fields: [{ id: 'overall', type: 'rating', label: 'Overall', required: true }],
  }
  state.insertFeedback.mockReset().mockResolvedValue({ id: 'feedback-1' })
  state.invitation = { id: 'invite-1', org_id: 'org-1', email: 'teacher@example.org', status: 'PENDING' }
  state.updateInvitation.mockReset().mockResolvedValue(true)
  state.claimLink = {
    org_id: 'org-1',
    contact_id: 'contact-1',
    publication_id: 'pub-1',
    email: 'teacher@example.org',
  }
  state.slot = slotRow
  state.offered = true
  state.claimSlot.mockReset().mockResolvedValue(slotRow)
  state.insertSession.mockReset().mockResolvedValue({ id: 'new-session-1' })
  state.revertClaim.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('submitFeedback', () => {
  const answered = { ...identity, answers: [{ fieldId: 'overall', value: '4' }] }

  it('stores a normalized submission and returns its id', async () => {
    await expect(submitFeedback('session-1', answered)).resolves.toEqual({ ok: true, id: 'feedback-1' })
    expect(state.insertFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Ada', email: 'ada@example.org', rating: 4 })
    )
  })

  it.each([
    ['missing identity', { ...answered, lastName: '  ' }, 'Please fill in your name and email.'],
    ['invalid email', { ...answered, email: 'not-an-email' }, 'Enter a valid email address.'],
    ['a required answer missing', { ...answered, answers: [] }, 'Please complete: Overall'],
    ['an out-of-range rating', { ...answered, answers: [{ fieldId: 'overall', value: '9' }] }, 'Invalid rating supplied for: Overall'],
  ])('returns a readable failure for %s', async (_label, input, message) => {
    await expect(submitFeedback('session-1', input)).resolves.toEqual({ ok: false, message })
    expect(state.insertFeedback).not.toHaveBeenCalled()
  })

  it('returns a failure for a missing session', async () => {
    state.session = null
    const result = await submitFeedback('session-1', answered)
    expect(result.ok).toBe(false)
  })

  it('returns a failure for an unpublished session', async () => {
    state.session = { ...state.session, status: 'DRAFT' }
    await expect(submitFeedback('session-1', answered)).resolves.toEqual({
      ok: false,
      message: 'Feedback can only be submitted for published sessions',
    })
  })

  it.each([
    ['before opening', '2026-10-09T09:44:59.999Z'],
    ['after closing', '2026-10-09T13:00:00.001Z'],
  ])('returns the closed-window failure %s', async (_label, now) => {
    vi.setSystemTime(new Date(now))
    await expect(submitFeedback('session-1', answered)).resolves.toEqual({
      ok: false,
      message: 'The feedback window for this session is closed',
      final: true,
    })
  })

  it('accepts a submission exactly at the inclusive close', async () => {
    vi.setSystemTime(new Date('2026-10-09T13:00:00.000Z'))
    await expect(submitFeedback('session-1', answered)).resolves.toMatchObject({ ok: true })
  })

  it('maps the one-response-per-email conflict to a readable failure', async () => {
    state.insertFeedback.mockRejectedValue(new DbConflictError('duplicate'))
    await expect(submitFeedback('session-1', answered)).resolves.toEqual({
      ok: false,
      message: 'Feedback has already been submitted for this email address',
    })
  })

  it('still throws unexpected database failures', async () => {
    state.insertFeedback.mockRejectedValue(new DbError('connection reset'))
    await expect(submitFeedback('session-1', answered)).rejects.toBeInstanceOf(DbError)
  })

  it('throws, rather than echoing, a malformed-input TypeError', async () => {
    const malformed = { ...answered, answers: 'nope' as unknown as [] }
    await expect(submitFeedback('session-1', malformed)).rejects.toBeInstanceOf(TypeError)
  })
})

describe('respondToInvitation', () => {
  it('records the response', async () => {
    await expect(respondToInvitation('CODE1234', 'Grace', 'Hopper', true)).resolves.toEqual({
      ok: true,
      status: 'ACCEPTED',
    })
    expect(state.updateInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ invitationId: 'invite-1', status: 'ACCEPTED' })
    )
  })

  it('returns a final failure for an unknown code', async () => {
    state.invitation = null
    const result = await respondToInvitation('NOPE', 'Grace', 'Hopper', true)
    expect(result).toMatchObject({ ok: false, final: true })
    expect(state.updateInvitation).not.toHaveBeenCalled()
  })

  it('returns a final failure when already responded', async () => {
    state.invitation = { ...state.invitation, status: 'DECLINED' }
    await expect(respondToInvitation('CODE1234', 'Grace', 'Hopper', true)).resolves.toEqual({
      ok: false,
      message: 'This invitation has already been responded to',
      final: true,
    })
    expect(state.updateInvitation).not.toHaveBeenCalled()
  })

  it('requires both names on the server (a retryable failure)', async () => {
    await expect(respondToInvitation('CODE1234', 'Grace', '   ', true)).resolves.toEqual({
      ok: false,
      message: 'Please enter your first and last name',
    })
    expect(state.updateInvitation).not.toHaveBeenCalled()
  })

  it('returns a final failure when a concurrent response won the update', async () => {
    state.updateInvitation.mockResolvedValue(false)
    await expect(respondToInvitation('CODE1234', 'Grace', 'Hopper', true)).resolves.toEqual({
      ok: false,
      message: 'This invitation has already been responded to',
      final: true,
    })
  })

  it('still throws unexpected database failures', async () => {
    state.updateInvitation.mockRejectedValue(new DbError('timeout'))
    await expect(respondToInvitation('CODE1234', 'Grace', 'Hopper', false)).rejects.toBeInstanceOf(DbError)
  })
})

describe('claimSlotByCode', () => {
  it('claims the slot and returns the new session id and the claimer\'s own RSVP page', async () => {
    const result = await claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')
    expect(result).toEqual({
      ok: true,
      sessionId: 'new-session-1',
      rsvpPath: expect.stringMatching(/^\/sessions\/new-session-1\/teacher-rsvp\/[A-Za-z0-9]{8}$/),
    })
  })

  it('returns a failure for an invalid link', async () => {
    state.claimLink = null
    const result = await claimSlotByCode('BAD', 'slot-1', 'Grace', 'Hopper')
    expect(result).toEqual({ ok: false, message: 'This claim link is not valid' })
  })

  it('returns a failure for blank names', async () => {
    const result = await claimSlotByCode('CLAIMCODE123', 'slot-1', ' ', 'Hopper')
    expect(result).toEqual({ ok: false, message: 'Please enter your name' })
    expect(state.claimSlot).not.toHaveBeenCalled()
  })

  it('returns a failure for a slot outside the invitation', async () => {
    state.offered = false
    const result = await claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')
    expect(result).toEqual({ ok: false, message: 'This slot is not part of your invitation' })
    expect(state.claimSlot).not.toHaveBeenCalled()
  })

  it('flags a vanished slot as unavailable', async () => {
    state.slot = null
    const result = await claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')
    expect(result).toMatchObject({ ok: false, slotUnavailable: true })
  })

  it('flags a lost first-come-first-served race as unavailable', async () => {
    state.claimSlot.mockResolvedValue(null)
    const result = await claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')
    expect(result).toEqual({
      ok: false,
      message: 'Sorry — this slot was just claimed by someone else.',
      slotUnavailable: true,
    })
    expect(state.insertSession).not.toHaveBeenCalled()
  })

  it('reports an expired slot as no longer available, not as taken by someone else', async () => {
    state.slot = { ...slotRow, date_start: '2026-10-09T10:00:00.000Z' }
    await expect(claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')).resolves.toEqual({
      ok: false,
      message: 'This slot is no longer available.',
      slotUnavailable: true,
    })
    expect(state.claimSlot).not.toHaveBeenCalled()
  })

  it('reports a slot another person already holds as no longer available', async () => {
    state.slot = { ...slotRow, status: 'CLAIMED', claimed_by_contact_id: 'contact-2', session_id: 's-2' }
    await expect(claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')).resolves.toMatchObject({
      ok: false,
      message: 'This slot is no longer available.',
    })
    expect(state.claimSlot).not.toHaveBeenCalled()
  })

  it('treats a retry of the visitor\'s own successful claim as success', async () => {
    state.slot = { ...slotRow, status: 'CLAIMED', claimed_by_contact_id: 'contact-1', session_id: 'session-9' }
    await expect(claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')).resolves.toEqual({
      ok: true,
      sessionId: 'session-9',
    })
    expect(state.claimSlot).not.toHaveBeenCalled()
    expect(state.insertSession).not.toHaveBeenCalled()
  })

  it('compensates and throws when session creation fails after winning', async () => {
    state.insertSession.mockRejectedValue(new DbError('insert failed'))
    await expect(claimSlotByCode('CLAIMCODE123', 'slot-1', 'Grace', 'Hopper')).rejects.toBeInstanceOf(DbError)
    expect(state.revertClaim).toHaveBeenCalledWith('slot-1')
  })
})

describe('claimSlotAsMember', () => {
  it('returns a failure when the slot was not offered', async () => {
    state.offered = false
    await expect(claimSlotAsMember('slot-1')).resolves.toEqual({
      ok: false,
      message: 'This slot has not been offered to you',
    })
  })

  it('flags a lost race as unavailable', async () => {
    state.claimSlot.mockResolvedValue(null)
    await expect(claimSlotAsMember('slot-1')).resolves.toMatchObject({ ok: false, slotUnavailable: true })
  })

  it('treats a retry of the member\'s own claim as success', async () => {
    state.slot = { ...slotRow, status: 'CLAIMED', claimed_by_user_id: 'user-1', session_id: 'session-9' }
    await expect(claimSlotAsMember('slot-1')).resolves.toEqual({ ok: true, sessionId: 'session-9' })
    expect(state.claimSlot).not.toHaveBeenCalled()
  })

  it('reports a closed slot as no longer available', async () => {
    state.slot = { ...slotRow, status: 'CLOSED' }
    await expect(claimSlotAsMember('slot-1')).resolves.toEqual({
      ok: false,
      message: 'This slot is no longer available.',
      slotUnavailable: true,
    })
  })
})
