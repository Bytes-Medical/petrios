import { cache } from 'react'
import { getCurrentOrgId, getCurrentUserId, isOrgAdmin } from '@/lib/auth'
import * as departmentsDb from '@/lib/db/departments'
import * as recallDb from '@/lib/db/recall'
import * as rotaDb from '@/lib/db/rota'
import { decideRotaModerator, type RotaModeratorDecision } from './authz'
import { getRotaIdentitySecret, isRotaKillSwitchOn } from './config'
import type { RotaAvailability } from './types'

/**
 * Server guards for every rota surface (spec/14). Server-only: never import
 * from a client component.
 *
 * Availability order: kill switch → identity secret → installed (063 applied
 * AND 064's Recall marker includes EXCUSED) → org enabled → department
 * enrolled. The two environment checks run before any lookup; the tenant
 * checks (enabled, enrolled) run only after the caller is authorized, so an
 * outsider cannot probe whether a department uses rota.
 *
 * "Installed" includes 064 because a confirmed rota excusal makes a trainee
 * EXCUSED, and only 064 keeps the Recall catch-up open to EXCUSED (O2).
 *
 * Deletion-only cleanup (disable, un-enrol, remove an uploader, revoke a
 * link) has its own guards that skip the kill switch and the secret, so data
 * can always be removed after an emergency switch-off.
 *
 * Authorization never calls requireDepartmentModerator or isSuperAdmin: a
 * super admin acting in another organisation gets nothing (decideRotaModerator).
 */

export class RotaAccessError extends Error {
  readonly code: 'unavailable' | 'forbidden'
  constructor(code: 'unavailable' | 'forbidden') {
    super(code === 'unavailable' ? 'Rota availability is not available.' : 'Rota access denied')
    this.name = 'RotaAccessError'
    this.code = code
  }
}

type PlatformReason = 'kill_switch' | 'secret_missing'

function platformUnavailable(): PlatformReason | null {
  if (!isRotaKillSwitchOn()) return 'kill_switch'
  if (!getRotaIdentitySecret()) return 'secret_missing'
  return null
}

function isNotInstalled(error: unknown): boolean {
  return error instanceof rotaDb.RotaNotInstalledError
}

/**
 * 064 applied: the Recall catch-up marker includes EXCUSED. Before that a
 * rota excusal would silently remove the trainee's catch-up route, so rota
 * stays "not installed". The marker read falls back to ['ABSENT'] when the
 * function is missing and never throws for "not installed".
 */
const recallExcusedCatchupReady = cache(async (): Promise<boolean> => {
  const statuses = await recallDb.listCatchupEligibleStatusesAsSystem()
  return statuses.includes('EXCUSED')
})

/**
 * Whether rota is usable for an organisation (and, when given, a department
 * of it). Callers must already have resolved `orgId` from the authenticated
 * caller, never from the request body. Never throws for "not installed".
 */
export async function getRotaAvailability(orgId: string, departmentId?: string): Promise<RotaAvailability> {
  const platform = platformUnavailable()
  if (platform) return { available: false, reason: platform }
  try {
    const [settings, enrolled, recallReady] = await Promise.all([
      rotaDb.getRotaSettings(orgId),
      departmentId ? rotaDb.isRotaDepartment(orgId, departmentId) : Promise.resolve(true),
      recallExcusedCatchupReady(),
    ])
    if (!recallReady) return { available: false, reason: 'not_installed' }
    if (!settings || !settings.enabled) return { available: false, reason: 'org_disabled' }
    if (!enrolled) return { available: false, reason: 'department_not_enrolled' }
    return {
      available: true,
      orgId,
      departmentId: departmentId ?? null,
      retentionDays: settings.retentionDays,
      horizonDays: settings.horizonDays,
    }
  } catch (error) {
    if (isNotInstalled(error)) return { available: false, reason: 'not_installed' }
    throw error
  }
}

const resolveRotaModeratorCached = cache(
  async (departmentId: string): Promise<{ decision: RotaModeratorDecision; userId: string | null; currentOrgId: string | null }> => {
    const userId = await getCurrentUserId()
    if (!userId || !departmentId) return { decision: { allowed: false, orgId: null }, userId: null, currentOrgId: null }
    const [departmentOrgId, currentOrgId, moderatorRowOrgIds] = await Promise.all([
      departmentsDb.findDepartmentOrgId(departmentId).catch(() => null),
      getCurrentOrgId(),
      departmentsDb.listDepartmentModeratorOrgIds(userId, departmentId).catch(() => [] as string[]),
    ])
    const orgAdminOfCurrentOrg = currentOrgId ? await isOrgAdmin(currentOrgId) : false
    return {
      decision: decideRotaModerator({ departmentOrgId, currentOrgId, orgAdminOfCurrentOrg, moderatorRowOrgIds }),
      userId,
      currentOrgId: departmentOrgId && currentOrgId === departmentOrgId ? currentOrgId : null,
    }
  }
)

async function requireAvailable(orgId: string, departmentId: string): Promise<void> {
  const availability = await getRotaAvailability(orgId, departmentId)
  if (!availability.available) throw new RotaAccessError('unavailable')
}

/**
 * Org admin of the department's organisation (the caller's current org) or a
 * department moderator of it, with rota available for the department.
 */
export async function requireRotaModerator(departmentId: string): Promise<{ orgId: string; userId: string }> {
  if (platformUnavailable()) throw new RotaAccessError('unavailable')
  const { decision, userId } = await resolveRotaModeratorCached(departmentId)
  if (!decision.allowed || !userId) throw new RotaAccessError('forbidden')
  await requireAvailable(decision.orgId, departmentId)
  return { orgId: decision.orgId, userId }
}

export async function isRotaModerator(departmentId: string): Promise<boolean> {
  try {
    await requireRotaModerator(departmentId)
    return true
  } catch (error) {
    if (error instanceof RotaAccessError) return false
    throw error
  }
}

/**
 * A rota moderator, or a holder of the narrow rota_uploaders grant for this
 * department whose current organisation is the department's organisation.
 */
export async function requireRotaUploaderOrModerator(
  departmentId: string
): Promise<{ orgId: string; userId: string; role: 'MODERATOR' | 'UPLOADER' }> {
  if (platformUnavailable()) throw new RotaAccessError('unavailable')
  const { decision, userId, currentOrgId } = await resolveRotaModeratorCached(departmentId)
  if (!userId) throw new RotaAccessError('forbidden')
  if (decision.allowed) {
    await requireAvailable(decision.orgId, departmentId)
    return { orgId: decision.orgId, userId, role: 'MODERATOR' }
  }
  if (!currentOrgId) throw new RotaAccessError('forbidden')
  let uploader: boolean
  try {
    uploader = await rotaDb.isRotaUploader(currentOrgId, departmentId, userId)
  } catch (error) {
    if (isNotInstalled(error)) throw new RotaAccessError('unavailable')
    throw error
  }
  if (!uploader) throw new RotaAccessError('forbidden')
  await requireAvailable(currentOrgId, departmentId)
  return { orgId: currentOrgId, userId, role: 'UPLOADER' }
}

async function resolveOrgAdmin(): Promise<{ orgId: string; userId: string }> {
  const [userId, orgId] = await Promise.all([getCurrentUserId(), getCurrentOrgId()])
  if (!userId || !orgId) throw new RotaAccessError('forbidden')
  if (!(await isOrgAdmin(orgId))) throw new RotaAccessError('forbidden')
  return { orgId, userId }
}

/**
 * Org admin of the caller's current organisation, for rota settings. The org
 * need not be enabled yet (this is how it gets enabled), but the kill switch,
 * the identity secret, migration 063 and migration 064 must all be in place.
 */
export async function requireRotaOrgAdmin(): Promise<{ orgId: string; userId: string }> {
  if (platformUnavailable()) throw new RotaAccessError('unavailable')
  const admin = await resolveOrgAdmin()
  try {
    const [, recallReady] = await Promise.all([rotaDb.getRotaSettings(admin.orgId), recallExcusedCatchupReady()])
    if (!recallReady) throw new RotaAccessError('unavailable')
  } catch (error) {
    if (isNotInstalled(error)) throw new RotaAccessError('unavailable')
    throw error
  }
  return admin
}

/**
 * Deletion-only org-admin actions (disable and delete, remove a department,
 * remove an uploader): org admin of the current organisation and migration
 * 063 present, WHATEVER the kill switch, the secret or 064 say, so stored
 * rota data can always be deleted after an emergency switch-off (spec/14).
 * Returns the current settings (null when the org never set rota up).
 */
export async function requireRotaOrgAdminForCleanup(): Promise<{
  orgId: string
  userId: string
  settings: Awaited<ReturnType<typeof rotaDb.getRotaSettings>>
}> {
  const admin = await resolveOrgAdmin()
  try {
    return { ...admin, settings: await rotaDb.getRotaSettings(admin.orgId) }
  } catch (error) {
    if (isNotInstalled(error)) throw new RotaAccessError('unavailable')
    throw error
  }
}

/**
 * Deletion-only moderator action (revoke an identity link): a rota moderator
 * of the department in the caller's current organisation and migration 063
 * present, whatever the kill switch, the secret, 064 or the org setting say.
 */
export async function requireRotaModeratorForCleanup(departmentId: string): Promise<{ orgId: string; userId: string }> {
  const { decision, userId } = await resolveRotaModeratorCached(departmentId)
  if (!decision.allowed || !userId) throw new RotaAccessError('forbidden')
  try {
    await rotaDb.getRotaSettings(decision.orgId)
  } catch (error) {
    if (isNotInstalled(error)) throw new RotaAccessError('unavailable')
    throw error
  }
  return { orgId: decision.orgId, userId }
}

// ---------------------------------------------------------------------------
// Error → RotaResult mapping shared by the rota server actions (plan §4.3).
// ---------------------------------------------------------------------------

export const ROTA_UNAVAILABLE_MESSAGE = 'Rota availability is not available.'
export const ROTA_FORBIDDEN_MESSAGE = 'You do not have access to rota availability for this department.'
const ROTA_GENERIC_MESSAGE = 'Something went wrong. Try again.'

export const ROTA_RPC_MESSAGES: Record<rotaDb.RotaRpcCode, string> = {
  disabled: 'Rota availability is not enabled for this department.',
  invalid_payload: 'The upload could not be read. Reload the page and try again.',
  batch_conflict: 'This upload was already sent with different content. Reload the page to start a new upload.',
  not_found: 'Session not found.',
  not_confirmable: 'Suggestions can be confirmed only after the session has ended and before attendance is finalized.',
  not_eligible: 'This person is no longer a trainee in this department.',
  suggestion_changed: 'This suggestion has changed or was already decided. Refresh to see the latest state.',
  presence_evidence: 'This trainee has attendance evidence, so the suggestion no longer applies.',
  already_decided: 'A moderator decision already exists for this trainee.',
  caught_up: 'This trainee completed the catch-up, so the suggestion no longer applies.',
  preview_required: 'Check matches for this upload first. Reload the page to start a new upload.',
}

/**
 * Maps any thrown error to `{ ok: false }`. Expected failures carry the copy
 * above; anything else is logged with its error name and code only (never a
 * message, body, id or identifier) and returns a generic message.
 */
export function toRotaFailure(error: unknown, context: string): { ok: false; message: string; code?: string } {
  if (error instanceof RotaAccessError) {
    return error.code === 'unavailable'
      ? { ok: false, message: ROTA_UNAVAILABLE_MESSAGE, code: 'unavailable' }
      : { ok: false, message: ROTA_FORBIDDEN_MESSAGE, code: 'forbidden' }
  }
  if (error instanceof rotaDb.RotaNotInstalledError) {
    return { ok: false, message: ROTA_UNAVAILABLE_MESSAGE, code: 'unavailable' }
  }
  if (error instanceof rotaDb.RotaRpcError) {
    return { ok: false, message: ROTA_RPC_MESSAGES[error.rotaCode], code: error.rotaCode }
  }
  const name = error instanceof Error ? error.name : 'unknown'
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
  console.error(`[rota] ${context} failed (${name}${code ? ` ${code}` : ''})`)
  return { ok: false, message: ROTA_GENERIC_MESSAGE }
}
