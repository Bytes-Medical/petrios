'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, getCurrentUser } from '@/lib/auth'
import * as personalWorkspacesDb from '@/lib/db/personal-workspaces'
import * as onboardingDb from '@/lib/db/onboarding'

export interface PersonalWorkspace {
  orgId: string
  departmentId: string
}

/**
 * Ensure the current user has somewhere to teach.
 *
 * Individuals who sign in without an enterprise invite have no organization,
 * which otherwise dead-ends them on the "Join a Department" wall. Rather than
 * loosen the multi-tenant invariants (every session needs an org + department),
 * we auto-provision a hidden *personal* organization + a default department and
 * make the user org_admin + department_admin of it. Every downstream subsystem
 * (sessions, QR, attendance, certificates, feedback) then works unchanged.
 *
 * Idempotent: if the user already belongs to any organization (personal or
 * enterprise), that membership is returned untouched. Runs with the service
 * client because org creation is otherwise a super-admin-only operation.
 */
export async function ensurePersonalWorkspace(): Promise<PersonalWorkspace> {
  const userId = await requireAuth()

  // Already a member of an org? Reuse it (oldest membership wins, matching the
  // "first workspace" intent). Personal users have exactly one department; for
  // enterprise users we just need *a* department id, so take the earliest.
  const existingOrgId = await personalWorkspacesDb.findOldestMembershipOrgId(userId)
  if (existingOrgId) {
    const departmentId = await personalWorkspacesDb.findOldestDepartmentId(existingOrgId)
    return { orgId: existingOrgId, departmentId: departmentId ?? '' }
  }

  // Derive a friendly workspace name from the user's profile / email.
  const user = await getCurrentUser()
  const profile = await onboardingDb.findProfileByUserId(userId)

  const displayName =
    profile?.full_name?.trim() ||
    profile?.first_name?.trim() ||
    (user?.email ? user.email.split('@')[0] : '') ||
    'My'
  const orgName = `${displayName}'s Teaching`

  // Create org + owner membership + default department + moderator role
  // (department_code auto-generates via DB default).
  const orgId = crypto.randomUUID()
  const departmentId = crypto.randomUUID()
  await personalWorkspacesDb.insertPersonalWorkspace({ orgId, departmentId, userId, orgName })

  revalidatePath('/dashboard')
  return { orgId, departmentId }
}
