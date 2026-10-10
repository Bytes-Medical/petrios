import { compareChronological, isWithinEvidenceWindow, type AttendanceWindowSession } from '@/lib/attendance/compute'
import type { AttendanceEvidence } from '@/lib/db/attendance'
import type { RotaFlagRow, RotaSuggestionRow, RotaSuggestionState } from './types'

/**
 * The "Expected roster" panel rows (spec/14, spec/03). Pure: no I/O.
 *
 * The panel lists the department's current trainees who have NO valid
 * presence evidence for the session, which also shows moderators who is
 * missing before finalize. A rota flag on such a row becomes a suggestion
 * the moderator may confirm (excused, rostered unavailable) or dismiss, one
 * person at a time. Rota data never decides attendance by itself.
 *
 * Row states:
 *   SUGGESTED         an OPEN flag and no moderator decision yet
 *   CONFIRMED         the rota excusal was confirmed (its evidence is primary)
 *   DISMISSED         the moderator dismissed the suggestion
 *   CONTESTED         the trainee said the rota was wrong; no suggestion is
 *                     shown and the moderator decides manually
 *   DECIDED_MANUALLY  a moderator decision other than the rota excusal exists
 *   NONE              no flag: listed only because there is no evidence yet
 *
 * A CONFIRMED row stays visible even after presence evidence arrives, with the
 * "Attendance evidence received after excusal" marker, so the moderator can
 * correct it (the latest moderator decision wins).
 *
 * A trainee with Recall catch-up (RECALL) evidence is not listed at all: the
 * completed catch-up is already the decision (after a reopen, a new excusal
 * would outrank it and the catch-up could not be redone), and the confirm RPC
 * refuses with rota:caught_up.
 */

export const PRESENCE_SOURCES = ['SELF_CHECKIN', 'GROUP_CODE', 'TEAMS', 'TEACHER'] as const

/** The metadata reason the confirm RPC writes on a rota excusal. */
export const ROTA_EXCUSAL_REASON_CODE = 'ROTA_UNAVAILABLE'

type SuggestionEvidence = Pick<AttendanceEvidence, 'user_id' | 'source' | 'observed_at' | 'metadata'> & {
  id?: string | null
  created_at?: string | null
}

const PRESENCE: ReadonlySet<string> = new Set(PRESENCE_SOURCES)

function isValidPresence(ev: SuggestionEvidence, session: AttendanceWindowSession): boolean {
  if (!PRESENCE.has(ev.source)) return false
  // An assigned teacher's attribution row is not attendance (policy v2).
  if (ev.source === 'TEACHER' && ev.metadata?.assigned_as_teacher === true) return false
  const at = new Date(ev.observed_at)
  if (Number.isNaN(at.getTime())) return false
  return isWithinEvidenceWindow(ev.source, at, session)
}

/** The latest moderator decision, ordered exactly like the SQL (observed_at, created_at, id). */
function latestModeratorDecision(rows: SuggestionEvidence[]): SuggestionEvidence | null {
  let latest: SuggestionEvidence | null = null
  for (const row of rows) {
    if (row.source !== 'MODERATOR_CONFIRMATION') continue
    if (!latest || compareChronological(row, latest) > 0) latest = row
  }
  return latest
}

function isRotaExcusal(row: SuggestionEvidence | null): boolean {
  return row?.metadata?.reason_code === ROTA_EXCUSAL_REASON_CODE
}

const STATE_ORDER: Record<RotaSuggestionState, number> = {
  SUGGESTED: 0,
  CONTESTED: 1,
  CONFIRMED: 2,
  DECIDED_MANUALLY: 3,
  DISMISSED: 4,
  NONE: 5,
}

export function buildRotaSuggestionRows(input: {
  trainees: { userId: string; displayName: string }[]
  evidence: SuggestionEvidence[]
  flags: RotaFlagRow[]
  session: AttendanceWindowSession & { attendance_phase: string }
  now: Date
}): RotaSuggestionRow[] {
  const { session, now } = input
  const nowMs = now.getTime()
  const started = nowMs >= Date.parse(session.date_start)
  const ended = nowMs >= Date.parse(session.date_end)
  const open = session.attendance_phase !== 'FINALIZED'
  const policyV2 = (session.attendance_policy_version ?? 1) >= 2

  const evidenceByUser = new Map<string, SuggestionEvidence[]>()
  for (const ev of input.evidence) {
    if (!ev.user_id) continue
    const list = evidenceByUser.get(ev.user_id)
    if (list) list.push(ev)
    else evidenceByUser.set(ev.user_id, [ev])
  }
  const flagByUser = new Map(input.flags.map((flag) => [flag.userId, flag]))

  const rows: RotaSuggestionRow[] = []
  const seen = new Set<string>()
  for (const trainee of input.trainees) {
    if (seen.has(trainee.userId)) continue
    seen.add(trainee.userId)

    const evidence = evidenceByUser.get(trainee.userId) ?? []
    // A completed catch-up is a decision: never suggest an excusal over it.
    if (evidence.some((ev) => ev.source === 'RECALL')) continue
    const flag = flagByUser.get(trainee.userId) ?? null
    const hasPresence = evidence.some((ev) => isValidPresence(ev, session))
    const decision = latestModeratorDecision(evidence)

    let state: RotaSuggestionState
    if (flag?.state === 'CONFIRMED') {
      // A later manual decision (the latest one wins) supersedes the excusal.
      state = decision && !isRotaExcusal(decision) ? 'DECIDED_MANUALLY' : 'CONFIRMED'
    } else if (hasPresence) {
      continue
    } else if (flag?.state === 'CONTESTED') {
      state = 'CONTESTED'
    } else if (decision) {
      state = 'DECIDED_MANUALLY'
    } else if (flag?.state === 'DISMISSED') {
      state = 'DISMISSED'
    } else if (flag?.state === 'OPEN') {
      state = 'SUGGESTED'
    } else {
      state = 'NONE'
    }

    const showsRota = state === 'SUGGESTED' || state === 'CONFIRMED' || state === 'DISMISSED'
    const actionable = state === 'SUGGESTED' && open && policyV2
    rows.push({
      userId: trainee.userId,
      displayName: trainee.displayName,
      state,
      asOf: showsRota && flag ? flag.asOf : null,
      kind: showsRota && flag ? flag.kind : null,
      markers: {
        contested: state === 'CONTESTED',
        rotaChanged: state === 'CONFIRMED' && Boolean(flag?.rotaChangedAt),
        evidenceAfterExcusal: state === 'CONFIRMED' && hasPresence,
      },
      // Confirm only after the session ends: until then check-in and teacher
      // marking can still record real attendance, which an excusal would hide.
      canConfirm: actionable && ended,
      canDismiss: actionable && started,
    })
  }

  return rows.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      a.displayName.localeCompare(b.displayName, 'en-GB') ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  )
}
