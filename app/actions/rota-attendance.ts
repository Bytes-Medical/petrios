'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentOrgId, getCurrentUserId } from '@/lib/auth'
import { appDayKey, formatInAppTimeZone } from '@/lib/datetime'
import * as attendanceDb from '@/lib/db/attendance'
import * as rotaDb from '@/lib/db/rota'
import * as sessionsDb from '@/lib/db/sessions'
import { getRotaAvailability, requireRotaModerator, RotaAccessError } from '@/lib/rota/access'
import { isRotaKillSwitchOn } from '@/lib/rota/config'
import { buildRotaSuggestionRows } from '@/lib/rota/suggestions'
import type { OwnRotaFlagView, RotaResult, RotaSuggestionsView } from '@/lib/rota/types'
import type { Session } from '@/lib/types'

/**
 * Rota availability on the attendance surfaces (spec/14, spec/03).
 *
 * - Moderators (requireRotaModerator: org admin of the session's org or a
 *   moderator of its department; never a super admin acting elsewhere) see
 *   the Expected roster suggestions on policy-v2 sessions and confirm or
 *   dismiss them one person at a time. Confirm is one transactional RPC that
 *   writes a MODERATOR_CONFIRMATION EXCUSED evidence row carrying the batch
 *   id; it is never a bulk action and never automatic.
 * - A trainee sees only their own flag and can contest it.
 *
 * Every function is inert (null / { ok: false }) unless the kill switch, the
 * identity secret, migration 063, the org setting and the department
 * enrolment all allow it. Expected failures return { ok: false, message };
 * nothing logs ids, names or rota data.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COPY = {
  disabled: 'Rota availability is not enabled for this department.',
  invalid_payload: 'The upload could not be read. Reload the page and try again.',
  batch_conflict: 'This upload was already sent with different content. Reload the page to start a new upload.',
  not_found: 'Session not found.',
  not_confirmable:
    'Suggestions can be confirmed only after the session has ended and before attendance is finalized.',
  not_eligible: 'This person is no longer a trainee in this department.',
  suggestion_changed: 'This suggestion has changed or was already decided. Refresh to see the latest state.',
  presence_evidence: 'This trainee has attendance evidence, so the suggestion no longer applies.',
  already_decided: 'A moderator decision already exists for this trainee.',
  caught_up: 'This trainee completed the catch-up, so the suggestion no longer applies.',
  preview_required: 'Check matches for this upload first. Reload the page to start a new upload.',
  unavailable: 'Rota availability is not available.',
  forbidden: 'You do not have access to rota availability for this department.',
  dismiss_not_open: 'Suggestions can be dismissed only after the session has started and before attendance is finalized.',
  unexpected: 'Something went wrong. Refresh the page and try again.',
} as const

type CopyKey = keyof typeof COPY

function fail<T>(code: CopyKey): RotaResult<T> {
  return { ok: false, message: COPY[code], code }
}

/** "Thu 14 Oct 06:00" in APP_TIME_ZONE (the fixed suggestion copy, spec/14). */
function formatRotaAsOf(iso: string): string {
  const day = formatInAppTimeZone(iso, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = formatInAppTimeZone(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${day} ${time}`.replace(/,/g, '')
}

/** Map a guard or DAL error to user copy; unexpected errors are logged without details. */
function failFromError<T>(error: unknown, logLabel: string): RotaResult<T> {
  if (error instanceof RotaAccessError) return fail(error.code)
  if (error instanceof rotaDb.RotaNotInstalledError) return fail('unavailable')
  if (error instanceof rotaDb.RotaRpcError) return fail(error.rotaCode)
  console.error(`[rota] ${logLabel} failed`)
  return fail('unexpected')
}

async function currentCaller(): Promise<{ userId: string; orgId: string } | null> {
  const [userId, orgId] = await Promise.all([getCurrentUserId(), getCurrentOrgId()])
  return userId && orgId ? { userId, orgId } : null
}

/**
 * The session in the caller's current org, authorized for rota moderation.
 * Null when not found; throws RotaAccessError when unavailable or forbidden.
 */
async function moderatedSession(sessionId: string): Promise<{ session: Session; orgId: string; userId: string } | null> {
  if (!UUID_RE.test(sessionId)) return null
  const caller = await currentCaller()
  if (!caller) throw new RotaAccessError('forbidden')
  const session = await sessionsDb.findSession(sessionId, caller.orgId)
  if (!session) return null
  const { orgId, userId } = await requireRotaModerator(session.department_id)
  // requireRotaModerator resolves the department's org; it must be the org the
  // session was read from (the caller's current org).
  if (orgId !== caller.orgId || orgId !== session.org_id) throw new RotaAccessError('forbidden')
  return { session, orgId, userId }
}

function revalidateSession(sessionId: string) {
  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
}

export async function getRotaSuggestionsForSession(sessionId: string): Promise<RotaSuggestionsView | null> {
  if (!isRotaKillSwitchOn()) return null
  try {
    const scoped = await moderatedSession(sessionId)
    if (!scoped) return null
    const { session, orgId } = scoped
    if ((session.attendance_policy_version ?? 1) < 2) return null
    if (session.attendance_phase === 'FINALIZED') return null
    // Drafts (and cancelled sessions) get no flags and cannot be confirmed.
    if (session.status !== 'PUBLISHED') return null
    const now = new Date()
    if (now.getTime() < Date.parse(session.date_start)) return null

    const [trainees, evidence, flags, latestWorked] = await Promise.all([
      rotaDb.listDepartmentTrainees(orgId, session.department_id),
      attendanceDb.listSessionEvidence(orgId, session.id),
      rotaDb.listFlagsForSession({ orgId, sessionId: session.id }),
      rotaDb.findLatestBatch({ orgId, departmentId: session.department_id, kind: 'WORKED' }),
    ])

    const rows = buildRotaSuggestionRows({
      trainees: trainees.map((trainee) => ({ userId: trainee.userId, displayName: trainee.displayName })),
      evidence,
      flags,
      session: { ...session, attendance_phase: session.attendance_phase ?? 'OPEN' },
      now,
    }).map((row) => ({ ...row, asOf: row.asOf ? formatRotaAsOf(row.asOf) : null }))

    return {
      sessionId: session.id,
      departmentId: session.department_id,
      readOnlyUntilEnd: now.getTime() < Date.parse(session.date_end),
      // An as-worked batch only ever covers days before its upload day, so the
      // question is whether the newest one reaches the session's day; until
      // then the suggestions come from the planned rota (an informational
      // note, never a reason to wait before finalizing).
      showAsWorkedBanner: !latestWorked || latestWorked.rangeTo < appDayKey(session.date_start),
      rows,
    }
  } catch (error) {
    if (error instanceof RotaAccessError || error instanceof rotaDb.RotaNotInstalledError) return null
    // The manage page must not fail because of the optional rota panel.
    console.error('[rota] suggestions read failed')
    return null
  }
}

export async function confirmRotaSuggestion(
  sessionId: string,
  userId: string
): Promise<RotaResult<{ status: 'EXCUSED' }>> {
  if (!isRotaKillSwitchOn()) return fail('unavailable')
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return fail('not_eligible')
  try {
    const scoped = await moderatedSession(sessionId)
    if (!scoped) return fail('not_found')
    const attendance = await rotaDb.confirmRotaExcusal({
      orgId: scoped.orgId,
      sessionId: scoped.session.id,
      userId,
      actorUserId: scoped.userId,
    })
    revalidateSession(scoped.session.id)
    if (attendance?.status !== 'EXCUSED') {
      // The RPC wrote the decision; a different status means a later
      // computation disagrees. Show the latest state rather than claim success.
      return fail('suggestion_changed')
    }
    return { ok: true, data: { status: 'EXCUSED' } }
  } catch (error) {
    return failFromError(error, 'confirm')
  }
}

export async function dismissRotaSuggestion(sessionId: string, userId: string): Promise<RotaResult<void>> {
  if (!isRotaKillSwitchOn()) return fail('unavailable')
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) return fail('not_eligible')
  try {
    const scoped = await moderatedSession(sessionId)
    if (!scoped) return fail('not_found')
    const { session } = scoped
    if (
      (session.attendance_policy_version ?? 1) < 2 ||
      session.attendance_phase === 'FINALIZED' ||
      session.status !== 'PUBLISHED' ||
      Date.now() < Date.parse(session.date_start)
    ) {
      return fail('dismiss_not_open')
    }
    const changed = await rotaDb.dismissRotaSuggestion({
      orgId: scoped.orgId,
      sessionId: session.id,
      userId,
      actorUserId: scoped.userId,
    })
    if (!changed) return fail('suggestion_changed')
    revalidateSession(session.id)
    return { ok: true, data: undefined }
  } catch (error) {
    return failFromError(error, 'dismiss')
  }
}

/**
 * The signed-in trainee's own flag for a session in their current org; null
 * when rota is unavailable there or there is no visible flag. Never another
 * person's flag: the user id comes from the session cookie only.
 */
export async function getMyRotaFlag(sessionId: string): Promise<OwnRotaFlagView | null> {
  if (!isRotaKillSwitchOn()) return null
  if (!UUID_RE.test(sessionId)) return null
  try {
    const caller = await currentCaller()
    if (!caller) return null
    const scope = await sessionsDb.findSessionScope(sessionId, caller.orgId)
    if (!scope) return null
    const availability = await getRotaAvailability(caller.orgId, scope.department_id)
    if (!availability.available) return null
    const flag = await rotaDb.findOwnFlag({ orgId: caller.orgId, sessionId: scope.id, userId: caller.userId })
    if (!flag) return null
    return {
      sessionId: scope.id,
      state: flag.state,
      asOfLabel: formatRotaAsOf(flag.asOf),
      kind: flag.kind,
      canContest: flag.state === 'OPEN',
      beforeSession: Date.now() < Date.parse(scope.date_start),
    }
  } catch (error) {
    if (error instanceof rotaDb.RotaNotInstalledError) return null
    // The session page must not fail because of the optional rota notice.
    console.error('[rota] own flag read failed')
    return null
  }
}

export async function contestMyRotaFlag(sessionId: string): Promise<RotaResult<void>> {
  if (!isRotaKillSwitchOn()) return fail('unavailable')
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) return fail('not_found')
  try {
    const caller = await currentCaller()
    if (!caller) return fail('forbidden')
    const scope = await sessionsDb.findSessionScope(sessionId, caller.orgId)
    if (!scope) return fail('not_found')
    const availability = await getRotaAvailability(caller.orgId, scope.department_id)
    if (!availability.available) return fail('unavailable')
    const changed = await rotaDb.contestOwnFlag({ orgId: caller.orgId, sessionId: scope.id, userId: caller.userId })
    if (!changed) return fail('suggestion_changed')
    revalidateSession(scope.id)
    return { ok: true, data: undefined }
  } catch (error) {
    return failFromError(error, 'contest')
  }
}
