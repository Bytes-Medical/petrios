'use server'

import { revalidatePath } from 'next/cache'
import {
  getCurrentOrgId,
  requireAuth,
  requireOrg,
  requireDepartmentModerator,
} from '@/lib/auth'
import { normalizeDepartmentFeedbackFields } from '@/lib/feedback-form'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import { DbNotFoundError } from '@/lib/db'
import type { TraineeGrade, UserRole } from '@/lib/types'

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

export async function addDepartmentMember(
  departmentId: string,
  userId: string,
  role: string
) {
  const orgId = await requireOrg()

  const member = await departmentsDb.insertDepartmentMember({
    orgId,
    departmentId,
    userId,
    role: role as UserRole,
  })

  revalidatePath(`/departments/${departmentId}`)
  revalidatePath('/admin')
  return member
}

export async function getDepartmentMembers(departmentId: string) {
  const orgId = await requireOrg()
  return departmentsDb.listDepartmentMembers(orgId, departmentId)
}

export async function getDepartmentMemberUsers(departmentId: string) {
  await requireDepartmentModerator(departmentId)

  const userIds = await departmentsDb.listDepartmentMemberUserIds(departmentId)
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

export async function getDepartmentLeadSettings(departmentId: string) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()

  const settings = await departmentsDb.findDepartmentSettings(departmentId, orgId)
  if (!settings) {
    throw new DbNotFoundError(`Department ${departmentId} not found`)
  }

  return {
    leadName: settings.leadName || '',
    feedbackFormFields: normalizeDepartmentFeedbackFields(settings.feedbackFormFields),
  }
}

export async function updateDepartmentLeadSettings(
  departmentId: string,
  leadName: string
) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()

  await departmentsDb.updateDepartmentLeadName(
    departmentId,
    orgId,
    leadName.trim() || null
  )

  revalidatePath('/dashboard')
  revalidatePath('/settings')
  revalidatePath(`/departments/${departmentId}`)
}

export async function leaveDepartment(departmentId: string) {
  const userId = await requireAuth()

  const orgId = await departmentsDb.findDepartmentOrgId(departmentId)
  if (!orgId) {
    throw new DbNotFoundError('Department not found')
  }

  await departmentsDb.deleteDepartmentMember(departmentId, userId)
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
  await requireDepartmentModerator(departmentId)

  const orgId = await departmentsDb.findDepartmentOrgId(departmentId)
  if (!orgId) {
    throw new DbNotFoundError('Department not found')
  }

  await departmentsDb.deleteDepartmentMember(departmentId, memberUserId)
  await departmentsDb.deleteOrgMember(orgId, memberUserId)

  revalidatePath(`/departments/${departmentId}`)
  revalidatePath('/admin')
  revalidatePath('/settings')
  return { success: true }
}
