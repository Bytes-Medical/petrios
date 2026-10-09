'use server'

import { checkIn } from '@/app/actions/attendance'
import { getEvidenceWindows, isWithinEvidenceWindow } from '@/lib/attendance/compute'
import { getCurrentOrgId, getCurrentUserId, isDepartmentModerator } from '@/lib/auth'
import { meetingDisplayName } from '@/lib/contacts'
import * as attendanceDb from '@/lib/db/attendance'
import * as onboardingDb from '@/lib/db/onboarding'
import * as sessionsDb from '@/lib/db/sessions'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'
import { meetingRoomName } from '@/lib/jitsi'
import { decideMeetingAccess, isInviteCode, isSessionId, meetingDenial } from '@/lib/meeting/access'
import { pseudonymousParticipantId } from '@/lib/meeting/claims'
import { getMeetingConfig } from '@/lib/meeting/config'
import { MeetingKeyError } from '@/lib/meeting/jwt'
import { mintMeetingToken } from '@/lib/meeting/token'
import type { MeetingCheckInResult, MeetingConfig, MeetingJoinResult } from '@/lib/meeting/types'
import { inviteCodeCapabilityOrWarn } from '@/lib/teacher-invitation-capability'
import type { Session } from '@/lib/types'

/*
 * Petrios Meet server actions: room passes for members and accepted external
 * teachers, and the check-in attempt made on joining.
 *
 * None of these throws for an expected outcome (Next masks thrown action
 * errors in production, spec/07). Unexpected failures are logged without any
 * token, key or email address and returned as a retryable "unavailable" (or
 * a "failed" check-in), which the panel can show and retry.
 *
 * Authorization (spec/04 "Petrios Meet"):
 *   - members: the session must be readable through RLS in the caller's
 *     current organization (the same read as the session page); moderator =
 *     department moderator (incl. org admin / super admin) or an ACCEPTED
 *     assigned teacher; everyone else joins as a participant.
 *   - external teachers: an ACCEPTED invitation matched on (invite code,
 *     session id) is the capability; they always moderate. The code counts
 *     as a capability only once the operator has removed migration 017's
 *     public teacher_invitations policies and set
 *     TEACHER_INVITATIONS_RLS_LOCKED=true (lib/teacher-invitation-capability).
 *   - everyone: PUBLISHED, location JITSI, inside the room window on the
 *     server clock; the pass is restricted to that one room and expires no
 *     later than the room close.
 */

const MAX_DISPLAY_NAME_LENGTH = 80
const EXTERNAL_TEACHER_FALLBACK_NAME = 'Guest teacher'

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
}

function roomDisplayName(name: string, fallback: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim()
  return (trimmed || fallback).slice(0, MAX_DISPLAY_NAME_LENGTH)
}

/** Config gate shared by both join actions. */
function embeddedMeetingConfig():
  | { ok: true; config: Extract<MeetingConfig, { ok: true }> }
  | { ok: false; result: MeetingJoinResult } {
  // getMeetingConfig logs a configuration error once; joins do not repeat it.
  const config = getMeetingConfig()
  if (!config.ok) return { ok: false, result: meetingDenial('unavailable') }
  if (config.mode === 'public') return { ok: false, result: meetingDenial('not_embedded') }
  return { ok: true, config }
}

async function issueJoin(
  config: Extract<MeetingConfig, { ok: true }>,
  input: {
    sessionId: string
    subjectKey: string
    displayName: string
    moderator: boolean
    now: Date
    closesAt: Date
  }
): Promise<MeetingJoinResult> {
  // The window is inclusive, but a pass must expire after it is issued and no
  // later than the room close: within the last second there is nothing to mint.
  if (Math.floor(input.closesAt.getTime() / 1000) <= Math.floor(input.now.getTime() / 1000)) {
    return meetingDenial('ended')
  }

  const id = await pseudonymousParticipantId(input.sessionId, input.subjectKey)
  let minted: { jwt: string | null; expiresAt: string | null }
  try {
    minted = await mintMeetingToken(config, {
      sessionId: input.sessionId,
      user: { id, name: input.displayName, moderator: input.moderator },
      now: input.now,
      closesAt: input.closesAt,
    })
  } catch (error) {
    if (error instanceof MeetingKeyError) {
      console.error('[petrios-meet] room pass signing failed:', error.message)
      return meetingDenial('unavailable')
    }
    throw error
  }

  return {
    ok: true,
    join: {
      domain: config.domain,
      roomName: meetingRoomName(input.sessionId, config),
      jwt: minted.jwt,
      expiresAt: minted.expiresAt,
      moderator: input.moderator,
      displayName: input.displayName,
    },
  }
}

/** Room pass for a signed-in member. Every call mints a fresh pass. */
export async function getMeetingJoin(sessionId: string): Promise<MeetingJoinResult> {
  try {
    if (!isSessionId(sessionId)) return meetingDenial('not_found')

    const userId = await getCurrentUserId()
    if (!userId) return meetingDenial('not_signed_in')

    const gate = embeddedMeetingConfig()
    if (!gate.ok) return gate.result

    const orgId = await getCurrentOrgId()
    if (!orgId) return meetingDenial('not_found')
    // RLS-honouring read in the caller's current org: only users who may read
    // the session get a pass, and org-admin semantics match isDepartmentModerator.
    const session = await sessionsDb.findSession(sessionId, orgId)
    if (!session) return meetingDenial('not_found')

    const now = new Date()
    // Status and window first, so a closed room costs no role queries.
    const gateDecision = decideMeetingAccess({ session, now, moderator: false })
    if (!gateDecision.ok) return gateDecision

    const [departmentModerator, teacher, profile] = await Promise.all([
      isDepartmentModerator(session.department_id),
      sessionsDb.findSessionTeacher(session.id, userId, orgId),
      onboardingDb.findProfileByUserId(userId),
    ])
    const decision = decideMeetingAccess({
      session,
      now,
      moderator: departmentModerator || teacher?.status === 'ACCEPTED',
    })
    if (!decision.ok) return decision

    return await issueJoin(gate.config, {
      sessionId: session.id,
      subjectKey: `user:${userId}`,
      displayName: roomDisplayName(meetingDisplayName(profile), 'Attendee'),
      moderator: decision.moderator,
      now,
      closesAt: decision.closesAt,
    })
  } catch (error) {
    console.error('[petrios-meet] could not issue a member room pass:', describeError(error))
    return meetingDenial('unavailable')
  }
}

/**
 * Room pass for an external (account-less) teacher. The ACCEPTED invitation
 * for this session is the capability; the pass names them from the
 * invitation (never the email) and makes them a moderator.
 */
export async function getExternalTeacherMeetingJoin(
  sessionId: string,
  inviteCode: string
): Promise<MeetingJoinResult> {
  try {
    if (!isSessionId(sessionId) || !isInviteCode(inviteCode)) return meetingDenial('invalid_invitation')

    const gate = embeddedMeetingConfig()
    if (!gate.ok) return gate.result

    // While teacher_invitations is world-readable/writable (migration 017),
    // a code proves nothing: never mint a moderator pass from it.
    if (!inviteCodeCapabilityOrWarn()) return { ...meetingDenial('unavailable'), retryable: false }

    const invitation = await teacherInvitationsDb.findInvitationByCodeAndSession({ inviteCode, sessionId })
    if (!invitation || invitation.session_id !== sessionId) return meetingDenial('invalid_invitation')
    if (invitation.status !== 'ACCEPTED') return meetingDenial('not_accepted')

    const session = await sessionsDb.findSessionForInvitationAsSystem({
      sessionId,
      orgId: invitation.org_id,
    })
    if (!session || session.id !== sessionId || session.org_id !== invitation.org_id) {
      return meetingDenial('not_found')
    }

    const now = new Date()
    const decision = decideMeetingAccess({ session, now, moderator: true })
    if (!decision.ok) return decision

    const name = meetingDisplayName({ first_name: invitation.first_name, last_name: invitation.last_name })
    return await issueJoin(gate.config, {
      sessionId: session.id,
      subjectKey: `invitation:${invitation.id}`,
      displayName: roomDisplayName(
        name === 'Attendee' ? EXTERNAL_TEACHER_FALLBACK_NAME : name,
        EXTERNAL_TEACHER_FALLBACK_NAME
      ),
      moderator: true,
      now,
      closesAt: decision.closesAt,
    })
  } catch (error) {
    console.error('[petrios-meet] could not issue an external teacher room pass:', describeError(error))
    return meetingDenial('unavailable')
  }
}

const CHECK_IN_MESSAGES = {
  ok: "You're checked in. Your attendance stays provisional until the moderator finalizes it.",
  already: "You're already checked in for this session. Your attendance stays provisional until the moderator finalizes it.",
  not_signed_in: 'Sign in again to record your check-in.',
  not_available: 'Check-in from the video room is not available for this session.',
  finalized:
    'Attendance for this session has been finalized. Contact the moderator if your result needs review.',
  before: 'Check-in for this session has not opened yet.',
  after: 'The check-in window has closed. A moderator can correct attendance during review.',
  code_required:
    'This session uses a session code. Enter the code your organiser shares in the Check in panel on this page.',
  failed: "We couldn't record your check-in. Use the Check in panel on this page.",
} as const

function outsideWindow(session: Session, now: Date): MeetingCheckInResult {
  const { checkInStart, checkInEnd } = getEvidenceWindows(session)
  return {
    ok: false,
    reason: 'outside_window',
    message: now < checkInStart ? CHECK_IN_MESSAGES.before : CHECK_IN_MESSAGES.after,
    window: { opensAt: checkInStart.toISOString(), closesAt: checkInEnd.toISOString() },
  }
}

/**
 * The self check-in attempted when a member joins the room (embedded) or
 * opens it (public mode). Wraps the existing checkIn path without changing
 * attendance semantics (spec/03): SELF_CHECKIN keeps its own window, an
 * active session code still blocks plain self check-in, and finalized
 * attendance is reported rather than retried. A member who already has
 * SELF_CHECKIN or GROUP_CODE evidence is told so and nothing is appended.
 */
export async function checkInFromMeeting(sessionId: string): Promise<MeetingCheckInResult> {
  let session: Session | null = null
  try {
    const userId = await getCurrentUserId()
    if (!userId) return { ok: false, reason: 'not_signed_in', message: CHECK_IN_MESSAGES.not_signed_in }
    if (!isSessionId(sessionId)) {
      return { ok: false, reason: 'not_available', message: CHECK_IN_MESSAGES.not_available }
    }

    const orgId = await getCurrentOrgId()
    session = orgId ? await sessionsDb.findSession(sessionId, orgId) : null
    if (!session || session.location_type !== 'JITSI' || session.status !== 'PUBLISHED') {
      return { ok: false, reason: 'not_available', message: CHECK_IN_MESSAGES.not_available }
    }
    if (session.attendance_phase === 'FINALIZED' || session.attendance_locked) {
      return { ok: false, reason: 'finalized', message: CHECK_IN_MESSAGES.finalized }
    }

    // Already checked in (self check-in, or the session code in the Check in
    // panel): say so instead of asking for the code again, and append nothing.
    if (await attendanceDb.userHasCheckInEvidence({ orgId: session.org_id, sessionId, userId })) {
      return { ok: true, message: CHECK_IN_MESSAGES.already }
    }

    const now = new Date()
    if (!isWithinEvidenceWindow('SELF_CHECKIN', now, session)) return outsideWindow(session, now)

    await checkIn(sessionId)
    return { ok: true, message: CHECK_IN_MESSAGES.ok }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/active session code is required/i.test(message)) {
      return { ok: false, reason: 'code_required', message: CHECK_IN_MESSAGES.code_required }
    }
    if (/Time window closed/i.test(message) && session) return outsideWindow(session, new Date())
    if (/Attendance is finalized/i.test(message)) {
      return { ok: false, reason: 'finalized', message: CHECK_IN_MESSAGES.finalized }
    }
    console.error('[petrios-meet] check-in from the video room failed:', describeError(error))
    return { ok: false, reason: 'failed', message: CHECK_IN_MESSAGES.failed }
  }
}

/** Provider error names are short identifiers such as 'conference.connectionError.notAllowed'. */
const PROVIDER_ERROR_NAME = /^[A-Za-z0-9._-]{1,80}$/

/**
 * The video service refused or dropped a connection BEFORE the participant
 * entered the room (typically a rejected room pass: wrong JaaS public key or
 * key id, or a self-hosted aud/sub/secret mismatch). Logs the provider's error
 * NAME, the mode and the session id, so the operator sees it in the server
 * logs; never a pass, a name or an email. Fire-and-forget from the panel;
 * anything that is not a plain identifier is dropped.
 */
export async function reportMeetingConnectError(sessionId: string, errorName: string): Promise<void> {
  try {
    if (!isSessionId(sessionId) || typeof errorName !== 'string' || !PROVIDER_ERROR_NAME.test(errorName)) return
    const config = getMeetingConfig()
    if (!config.ok || config.mode === 'public') return
    console.error(
      `[petrios-meet] the video service refused a ${config.mode} room connection before join (session ${sessionId}): ${errorName}. If this repeats, check the room-pass settings (spec/04 "Petrios Meet").`
    )
  } catch {
    // Reporting is best effort.
  }
}
