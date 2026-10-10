'use server'

import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import * as rotaDb from '@/lib/db/rota'
import { DbError } from '@/lib/db'
import { RotaAccessError, requireRotaOrgAdmin, requireRotaOrgAdminForCleanup, toRotaFailure } from '@/lib/rota/access'
import { isRotaKillSwitchOn } from '@/lib/rota/config'
import { normaliseEmail } from '@/lib/rota/identity-normalise'
import type { RotaAdminState, RotaResult } from '@/lib/rota/types'

/**
 * Org-admin rota settings (spec/14). Every action requires an org admin of
 * the caller's CURRENT organisation. Actions that set rota up or widen it
 * (governance, enable, enrol, grant) use requireRotaOrgAdmin: kill switch,
 * identity secret, 063 and 064 installed. The deletion-only actions (disable
 * and delete, remove a department, remove an uploader) use
 * requireRotaOrgAdminForCleanup, which skips the switch and the secret, so
 * stored rota data can always be deleted after an emergency switch-off.
 * Expected failures come back as `{ ok: false, message }`; nothing here logs
 * a body.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GOVERNANCE_MESSAGE = 'Enter the DPIA reference and confirm the privacy notice first.'

function displayName(profile: { full_name: string | null; first_name: string | null; last_name: string | null; email: string } | undefined): string {
  if (!profile) return 'Unknown member'
  const full = profile.full_name?.trim()
  if (full) return full
  const parts = [profile.first_name, profile.last_name].filter((p) => p && p.trim()).join(' ').trim()
  return parts || profile.email || 'Unknown member'
}

async function profilesFor(userIds: string[]) {
  const out = new Map<string, Awaited<ReturnType<typeof onboardingDb.listProfilesForUsers>>[number]>()
  const unique = [...new Set(userIds)]
  for (let i = 0; i < unique.length; i += 100) {
    for (const profile of await onboardingDb.listProfilesForUsers(unique.slice(i, i + 100))) {
      out.set(profile.user_id, profile)
    }
  }
  return out
}

async function requireDepartmentInOrg(departmentId: string, orgId: string): Promise<boolean> {
  if (!UUID.test(departmentId)) return false
  const departmentOrgId = await departmentsDb.findDepartmentOrgId(departmentId)
  return departmentOrgId === orgId
}

async function loadAdminState(orgId: string, cleanupOnly: boolean): Promise<RotaAdminState> {
  const [settings, departments, enrolledIds, uploaders] = await Promise.all([
    rotaDb.getRotaSettings(orgId),
    departmentsDb.listDepartmentsByOrg(orgId),
    rotaDb.listRotaDepartmentIds(orgId),
    rotaDb.listRotaUploaders(orgId),
  ])
  const profiles = await profilesFor(uploaders.map((u) => u.userId))
  const enrolled = new Set(enrolledIds)
  return {
    cleanupOnly,
    settings,
    departments: departments
      .map((d) => ({ id: d.id, name: d.name, enrolled: enrolled.has(d.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    uploaders: uploaders.map((u) => ({
      departmentId: u.departmentId,
      userId: u.userId,
      displayName: displayName(profiles.get(u.userId)),
      grantedAt: u.grantedAt,
    })),
  }
}

/**
 * The Settings section. Full controls while rota is installed and switched
 * on. Otherwise, when this organisation still has rota data or grants
 * (enabled, enrolled departments, uploaders), a cleanup-only state that
 * offers just the deletion actions; else the failure (the page hides it
 * while the kill switch is off).
 */
export async function getRotaAdminState(): Promise<RotaResult<RotaAdminState>> {
  try {
    const { orgId } = await requireRotaOrgAdmin()
    return { ok: true, data: await loadAdminState(orgId, false) }
  } catch (error) {
    if (!(error instanceof RotaAccessError && error.code === 'unavailable')) return toRotaFailure(error, 'admin state')
    try {
      const { orgId, settings } = await requireRotaOrgAdminForCleanup()
      // No settings row means rota was never set up here (enrolment creates it).
      if (settings) {
        const state = await loadAdminState(orgId, true)
        const holdsData = settings.enabled || state.departments.some((d) => d.enrolled) || state.uploaders.length > 0
        if (holdsData) return { ok: true, data: state }
      }
    } catch (cleanupError) {
      if (!(cleanupError instanceof RotaAccessError)) return toRotaFailure(cleanupError, 'admin state')
    }
    return isRotaKillSwitchOn()
      ? toRotaFailure(error, 'admin state')
      : { ok: false, message: 'Rota availability is off.', code: 'kill_switch' }
  }
}

export async function saveRotaGovernance(input: {
  dpiaReference: string
  privacyNoticeConfirmed: boolean
  retentionDays: number
  horizonDays: number
}): Promise<RotaResult<void>> {
  try {
    const { orgId, userId } = await requireRotaOrgAdmin()
    const dpiaReference = typeof input?.dpiaReference === 'string' ? input.dpiaReference.trim() : ''
    const privacyNoticeConfirmed = input?.privacyNoticeConfirmed === true
    const retentionDays = Number(input?.retentionDays)
    const horizonDays = Number(input?.horizonDays)
    if (dpiaReference && (dpiaReference.length < 3 || dpiaReference.length > 120)) {
      return { ok: false, message: 'The DPIA reference must be 3 to 120 characters.' }
    }
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
      return { ok: false, message: 'Retention must be a whole number of days from 1 to 90.' }
    }
    if (!Number.isInteger(horizonDays) || horizonDays < 7 || horizonDays > 84) {
      return { ok: false, message: 'The upload horizon must be a whole number of days from 7 to 84.' }
    }
    const current = await rotaDb.getRotaSettings(orgId)
    if (current?.enabled && (!dpiaReference || !privacyNoticeConfirmed)) {
      return { ok: false, message: 'Disable rota availability before removing the DPIA reference or the notice confirmation.' }
    }
    await rotaDb.saveRotaGovernance({ orgId, actorUserId: userId, dpiaReference, privacyNoticeConfirmed, retentionDays, horizonDays })
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'save governance')
  }
}

export async function enableRota(): Promise<RotaResult<void>> {
  try {
    const { orgId, userId } = await requireRotaOrgAdmin()
    const settings = await rotaDb.getRotaSettings(orgId)
    if (!settings || !settings.dpiaReference || !settings.privacyNoticeConfirmedAt) {
      return { ok: false, message: GOVERNANCE_MESSAGE, code: 'governance_required' }
    }
    try {
      await rotaDb.setRotaEnabled({ orgId, actorUserId: userId })
    } catch (error) {
      if (error instanceof DbError && error.code === '23514') {
        return { ok: false, message: GOVERNANCE_MESSAGE, code: 'governance_required' }
      }
      throw error
    }
    console.info('[rota] enabled for an organisation')
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'enable')
  }
}

export async function disableRota(confirmation: string): Promise<RotaResult<{ deleted: Record<string, number> }>> {
  try {
    // Deletion only: works with the kill switch off (spec/14).
    const { orgId, userId } = await requireRotaOrgAdminForCleanup()
    if (confirmation !== 'DISABLE') {
      return { ok: false, message: 'Type DISABLE to confirm.', code: 'confirmation_required' }
    }
    const deleted = await rotaDb.disableRotaForOrg({ orgId, actorUserId: userId })
    console.info('[rota] disabled for an organisation', deleted)
    return { ok: true, data: { deleted } }
  } catch (error) {
    return toRotaFailure(error, 'disable')
  }
}

export async function setRotaDepartmentEnrolment(departmentId: string, enrolled: boolean): Promise<RotaResult<void>> {
  try {
    // Enrolling needs rota fully available; removing (deletes the
    // department's flags and uploader grants) works with the switch off.
    const { orgId, userId } = enrolled === true ? await requireRotaOrgAdmin() : await requireRotaOrgAdminForCleanup()
    if (!(await requireDepartmentInOrg(departmentId, orgId))) {
      return { ok: false, message: 'Department not found.', code: 'not_found' }
    }
    await rotaDb.setRotaDepartmentEnrolment({ orgId, departmentId, enrolled: enrolled === true, actorUserId: userId })
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'department enrolment')
  }
}

export async function grantRotaUploader(departmentId: string, email: string): Promise<RotaResult<void>> {
  try {
    const { orgId, userId } = await requireRotaOrgAdmin()
    if (!(await requireDepartmentInOrg(departmentId, orgId))) {
      return { ok: false, message: 'Department not found.', code: 'not_found' }
    }
    if (!(await rotaDb.isRotaDepartment(orgId, departmentId))) {
      return { ok: false, message: 'Enrol the department in rota availability first.', code: 'not_enrolled' }
    }
    const wanted = typeof email === 'string' ? normaliseEmail(email) : null
    if (!wanted) return { ok: false, message: 'Enter a valid email address.' }

    const members = await onboardingDb.listOrganizationMembers(orgId)
    const profiles = await profilesFor(members.map((m) => m.user_id))
    const match = members.find((m) => profiles.get(m.user_id)?.email?.trim().toLowerCase() === wanted)
    if (!match) {
      return { ok: false, message: 'No member of this organisation has that email. Invite them to the organisation first.', code: 'not_member' }
    }
    // A trainee of the department could match themselves and send themselves
    // as "available", deleting their own open flags (spec/14).
    const trainees = await rotaDb.listDepartmentTrainees(orgId, departmentId)
    if (trainees.some((t) => t.userId === match.user_id)) {
      return {
        ok: false,
        message: 'A trainee of this department cannot upload its rota. Choose a rota coordinator who is not a trainee here.',
        code: 'trainee_uploader',
      }
    }
    await rotaDb.grantRotaUploader({ orgId, departmentId, userId: match.user_id, grantedBy: userId })
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'grant uploader')
  }
}

export async function revokeRotaUploader(departmentId: string, userId: string): Promise<RotaResult<void>> {
  try {
    // Deletion only: works with the kill switch off.
    const { orgId } = await requireRotaOrgAdminForCleanup()
    if (!(await requireDepartmentInOrg(departmentId, orgId)) || !UUID.test(userId)) {
      return { ok: false, message: 'Department not found.', code: 'not_found' }
    }
    await rotaDb.revokeRotaUploader({ orgId, departmentId, userId })
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'revoke uploader')
  }
}
