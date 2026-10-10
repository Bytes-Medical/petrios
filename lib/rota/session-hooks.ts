import * as rotaDb from '@/lib/db/rota'
import { isRotaKillSwitchOn } from './config'

/**
 * Rota availability hooks on existing session and membership actions
 * (spec/14, spec/04). Server-only: never import from a client component.
 *
 * Both hooks are best-effort cleanup that runs AFTER the caller's own write
 * has succeeded, so they never throw: the user's edit or removal has already
 * happened, and the snapshot read rule (rota_visible_session_flags) plus the
 * retention purge are the backstops when a hook does not run (kill switch
 * off, migration 063 not applied, or a transient failure).
 *
 * - They run only when ROTA_INTEGRATION_ENABLED is exactly "true".
 * - "Not installed" (063 not applied) is silent.
 * - Any other failure is logged without ids or values.
 */

interface SessionScheduleFacts {
  date_start: string
  date_end: string
  status: string
}

function sameInstant(a: string, b: string): boolean {
  const ms = (value: string) => {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : parsed
  }
  return ms(a) === ms(b)
}

/**
 * True when an edit invalidates the session's rota flags: its times moved, or
 * it became CANCELLED. Flags snapshot the session times, so a moved session
 * needs the next upload to recompute them.
 */
export function sessionScheduleChangeInvalidatesFlags(
  before: SessionScheduleFacts,
  after: SessionScheduleFacts
): boolean {
  if (!sameInstant(before.date_start, after.date_start)) return true
  if (!sameInstant(before.date_end, after.date_end)) return true
  return after.status === 'CANCELLED' && before.status !== 'CANCELLED'
}

/** Called by updateSession after a successful update. */
export async function onSessionScheduleChanged(input: {
  orgId: string
  sessionId: string
  before: SessionScheduleFacts
  after: SessionScheduleFacts
}): Promise<void> {
  if (!isRotaKillSwitchOn()) return
  if (!sessionScheduleChangeInvalidatesFlags(input.before, input.after)) return
  try {
    await rotaDb.deleteFlagsForSession({ orgId: input.orgId, sessionId: input.sessionId })
  } catch (error) {
    if (error instanceof rotaDb.RotaNotInstalledError) return
    console.error('[rota] session flag cleanup failed')
  }
}

/**
 * Called by removeDepartmentMember / leaveDepartment after the membership
 * row is deleted: the person's flags for that department go now, and the
 * DAL's org-scoped purge removes their identity link once they are no
 * longer a trainee of any enrolled department.
 */
export async function onDepartmentMemberRemoved(input: {
  orgId: string
  departmentId: string
  userId: string
}): Promise<void> {
  if (!isRotaKillSwitchOn()) return
  try {
    await rotaDb.deleteFlagsForMember({
      orgId: input.orgId,
      departmentId: input.departmentId,
      userId: input.userId,
    })
  } catch (error) {
    if (error instanceof rotaDb.RotaNotInstalledError) return
    console.error('[rota] member flag cleanup failed')
  }
}
