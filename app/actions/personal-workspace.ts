'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, getCurrentUser } from '@/lib/auth'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

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
  const supabase = await createSupabaseServiceClient()

  // Already a member of an org? Reuse it (oldest membership wins, matching the
  // "first workspace" intent). Personal users have exactly one department; for
  // enterprise users we just need *a* department id, so take the earliest.
  const { data: existingMembership } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingMembership?.org_id) {
    const { data: dept } = await supabase
      .from('departments')
      .select('id')
      .eq('org_id', existingMembership.org_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    return { orgId: existingMembership.org_id, departmentId: dept?.id ?? '' }
  }

  // Derive a friendly workspace name from the user's profile / email.
  const user = await getCurrentUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, first_name, email')
    .eq('user_id', userId)
    .maybeSingle()

  const displayName =
    profile?.full_name?.trim() ||
    profile?.first_name?.trim() ||
    (user?.email ? user.email.split('@')[0] : '') ||
    'My'
  const orgName = `${displayName}'s Teaching`

  // Create the personal org.
  const orgId = crypto.randomUUID()
  const { error: orgError } = await supabase
    .from('organizations')
    .insert({ id: orgId, name: orgName, created_by: userId, is_personal: true })
  if (orgError) {
    throw new Error(`Failed to create personal workspace: ${orgError.message}`)
  }

  // Owner of their own workspace.
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({ org_id: orgId, user_id: userId, role: 'org_admin' })
  if (memberError) {
    throw new Error(`Failed to add workspace membership: ${memberError.message}`)
  }

  // Default department (department_code auto-generates via DB default).
  const departmentId = crypto.randomUUID()
  const { error: deptError } = await supabase
    .from('departments')
    .insert({ id: departmentId, org_id: orgId, name: 'My Teaching', created_by: userId })
  if (deptError) {
    throw new Error(`Failed to create department: ${deptError.message}`)
  }

  // Moderator of that department so "Create Session" is enabled.
  const { error: deptMemberError } = await supabase
    .from('department_members')
    .insert({
      org_id: orgId,
      department_id: departmentId,
      user_id: userId,
      role: 'department_admin',
    })
  if (deptMemberError) {
    throw new Error(`Failed to add department membership: ${deptMemberError.message}`)
  }

  revalidatePath('/dashboard')
  return { orgId, departmentId }
}
