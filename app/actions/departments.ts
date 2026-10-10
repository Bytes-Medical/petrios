'use server'

import { revalidatePath } from 'next/cache'
import {
  getCurrentOrgId,
  requireAuth,
  requireOrg,
  requireOrgScope,
  requireDepartmentModerator,
} from '@/lib/auth'
import { departmentMemberRemovalBlock } from '@/lib/department-authz'
import { normalizeDepartmentFeedbackFields } from '@/lib/feedback-form'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import { DbNotFoundError } from '@/lib/db'
import type { TraineeGrade, UserRole } from '@/lib/types'
import { validateTeachingCoordinatorNames } from '@/lib/certificates/coordinators'
import { validateDepartmentName } from '@/lib/tenant-names'

export async function createDepartment(name: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()

  const department = await departmentsDb.insertDepartment({
    orgId,
    name,
    createdBy: userId,
  })

  revalidatePath('/departments')
  revalidatePath('/admin')
  return department
}

export async function getDepartmentsForOrg(orgId: string) {
  // Server components pass the current org; never serve another tenant's
  // departments (which carry their department_code join capability).
  await requireOrgScope(orgId)
  return departmentsDb.listDepartmentsByOrg(orgId)
}

export async function getDepartments() {
  const orgId = await requireOrg()
  return departmentsDb.listDepartmentsByOrg(orgId)
}

export async function getDepartment(id: string) {
  const orgId = await requireOrg()
  return departmentsDb.getDepartmentOrThrow(id, orgId)
}

export async function getDepartmentMembers(departmentId: string) {
  const orgId = await requireOrg()
  return departmentsDb.listDepartmentMembers(orgId, departmentId)
}

export async function getDepartmentMemberUsers(departmentId: string) {
  const { orgId } = await requireDepartmentModerator(departmentId)

  const userIds = await departmentsDb.listDepartmentMemberUserIds(departmentId, orgId)
  if (userIds.length === 0) return []

  // Emails come from the profiles mirror (synced from auth users) in ONE
  // query, replacing an N-per-member GoTrue admin API fan-out. Coverage
  // verified: every department_members user has a profiles row; any user
  // somehow missing one appears with a null email rather than vanishing.
  const profiles = await onboardingDb.listProfilesForUsers(userIds)
  const emailByUserId = new Map(profiles.map((p) => [p.user_id, p.email]))

  return userIds.map((userId) => ({
    id: userId,
    email: emailByUserId.get(userId) ?? null,
  }))
}

export async function getMyModeratedDepartments(orgId?: string) {
  const userId = await requireAuth()
  const resolvedOrgId = orgId || (await getCurrentOrgId())
  if (!resolvedOrgId) return []
  return departmentsDb.listModeratedDepartments(userId, resolvedOrgId)
}

export async function getMyModeratedDepartment(orgId?: string) {
  const departments = await getMyModeratedDepartments(orgId)
  return departments[0] ?? null
}

export async function getDepartmentCertificateSettings(departmentId: string) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()

  const settings = await departmentsDb.findDepartmentSettings(departmentId, orgId)
  if (!settings) {
    throw new DbNotFoundError(`Department ${departmentId} not found`)
  }

  return {
    coordinatorNames:
      settings.coordinatorNames.length > 0
        ? settings.coordinatorNames
        : settings.leadName
          ? [settings.leadName]
          : [],
    feedbackFormFields: normalizeDepartmentFeedbackFields(settings.feedbackFormFields),
  }
}

export async function updateDepartmentCertificateSettings(
  departmentId: string,
  coordinatorNames: string[]
) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()
  const normalizedNames = validateTeachingCoordinatorNames(coordinatorNames)

  await departmentsDb.updateDepartmentCertificateCoordinators(
    departmentId,
    orgId,
    normalizedNames
  )

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/departments/${departmentId}`)
}

export async function updateDepartmentName(departmentId: string, name: string) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()
  const normalizedName = validateDepartmentName(name)

  await departmentsDb.updateDepartmentName(departmentId, orgId, normalizedName)

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath('/departments')
  revalidatePath(`/departments/${departmentId}`)
  revalidatePath('/admin')
}

export async function leaveDepartment(departmentId: string) {
  const userId = await requireAuth()

  const orgId = await departmentsDb.findDepartmentOrgId(departmentId)
  if (!orgId) {
    throw new DbNotFoundError('Department not found')
  }

  await departmentsDb.deleteDepartmentMember(departmentId, orgId, userId)
  await departmentsDb.deleteOrgMember(orgId, userId)

  revalidatePath('/dashboard')
  revalidatePath('/departments')
  revalidatePath('/admin')
  return { success: true }
}

export interface DepartmentMemberWithProfile {
  user_id: string
  email: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  grade: TraineeGrade | null
  role: UserRole
  joined_at: string
}

export async function getDepartmentMembersWithProfiles(
  departmentId: string
): Promise<DepartmentMemberWithProfile[]> {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()

  const members = await departmentsDb.listDepartmentMembersWithProfiles(orgId, departmentId)
  return members.map((m) => ({
    user_id: m.user_id,
    email: m.email,
    full_name: m.full_name,
    first_name: m.first_name,
    last_name: m.last_name,
    grade: m.grade as TraineeGrade | null,
    role: m.role,
    joined_at: m.created_at,
  }))
}

export async function removeDepartmentMember(
  departmentId: string,
  memberUserId: string
) {
  // The helper resolves the department's organisation on the server and
  // only passes when the caller moderates it from that organisation; every
  // write below is scoped to that org.
  const { orgId } = await requireDepartmentModerator(departmentId)

  const [departmentRole, orgRole, moderatesAnyDepartmentInOrg] = await Promise.all([
    departmentsDb.findDepartmentMemberRole({ departmentId, orgId, userId: memberUserId }),
    onboardingDb.findOrganizationMembershipRole({ orgId, userId: memberUserId }),
    onboardingDb.hasDepartmentAdminRole({ orgId, userId: memberUserId }),
  ])
  const blocked = departmentMemberRemovalBlock({
    departmentRole,
    orgRole,
    moderatesAnyDepartmentInOrg,
  })
  if (blocked === 'not-a-member') {
    throw new DbNotFoundError('Member not found in this department')
  }
  if (blocked === 'protected-role') {
    throw new Error('Administrators cannot be removed from the members panel')
  }

  await departmentsDb.deleteDepartmentMember(departmentId, orgId, memberUserId)
  await departmentsDb.deleteOrgMember(orgId, memberUserId)

  revalidatePath(`/departments/${departmentId}`)
  revalidatePath('/admin')
  revalidatePath('/settings')
  return { success: true }
}
