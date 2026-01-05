'use server'

import { createSupabaseClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireAuth, getCurrentUser, isSuperAdmin, isDepartmentModerator } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { UserRole } from '@/lib/types'

export async function createDepartmentJoinRequest(
  orgId: string,
  departmentId: string,
  requestedRole: UserRole = 'trainee'
) {
  const userId = await requireAuth()
  const user = await getCurrentUser()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('department_join_requests')
    .insert({
      org_id: orgId,
      department_id: departmentId,
      user_id: userId,
      user_email: user?.email || '',
      requested_role: requestedRole,
      status: 'PENDING',
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create join request: ${error.message}`)
  }

  revalidatePath('/admin')
  return data
}

export async function getPendingDepartmentJoinRequests() {
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('department_join_requests')
    .select('*, departments:department_id (id, name), organizations:org_id (id, name)')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch join requests: ${error.message}`)
  }

  return data || []
}

export async function getAllPendingDepartmentJoinRequests() {
  const supabase = await createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('department_join_requests')
    .select('*, departments:department_id (id, name), organizations:org_id (id, name)')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch join requests: ${error.message}`)
  }

  return data || []
}

export async function approveDepartmentJoinRequest(requestId: string, role: UserRole = 'trainee') {
  const userId = await requireAuth()
  const supabase = await createSupabaseServiceClient()

  const { data: request, error: requestError } = await supabase
    .from('department_join_requests')
    .select('*')
    .eq('id', requestId)
    .single()

  if (requestError || !request) {
    throw new Error('Join request not found')
  }

  if (request.status !== 'PENDING') {
    throw new Error('Join request already processed')
  }

  const allowed = (await isSuperAdmin()) || (await isDepartmentModerator(request.department_id))
  if (!allowed) {
    throw new Error('Not authorized to approve this request')
  }

  const { error: updateError } = await supabase
    .from('department_join_requests')
    .update({
      status: 'APPROVED',
      decided_at: new Date().toISOString(),
      decided_by: userId,
    })
    .eq('id', requestId)

  if (updateError) {
    throw new Error(`Failed to approve join request: ${updateError.message}`)
  }

  const requestedRole = role || request.requested_role || 'trainee'

  const { error: cleanupDeptError } = await supabase
    .from('department_members')
    .delete()
    .eq('user_id', request.user_id)
    .neq('org_id', request.org_id)

  if (cleanupDeptError) {
    throw new Error(`Failed to remove previous department memberships: ${cleanupDeptError.message}`)
  }

  const { error: cleanupOrgError } = await supabase
    .from('organization_members')
    .delete()
    .eq('user_id', request.user_id)
    .neq('org_id', request.org_id)

  if (cleanupOrgError) {
    throw new Error(`Failed to remove previous organization memberships: ${cleanupOrgError.message}`)
  }

  const { error: orgMemberError } = await supabase
    .from('organization_members')
    .upsert({
      org_id: request.org_id,
      user_id: request.user_id,
      role: requestedRole,
    }, { onConflict: 'org_id,user_id' })

  if (orgMemberError) {
    throw new Error(`Failed to add organization member: ${orgMemberError.message}`)
  }

  const { error: memberError } = await supabase
    .from('department_members')
    .upsert({
      org_id: request.org_id,
      department_id: request.department_id,
      user_id: request.user_id,
      role: requestedRole,
    }, { onConflict: 'department_id,user_id' })

  if (memberError) {
    throw new Error(`Failed to add member: ${memberError.message}`)
  }

  revalidatePath('/admin')
  return { success: true }
}

export async function rejectDepartmentJoinRequest(requestId: string) {
  const userId = await requireAuth()
  const supabase = await createSupabaseServiceClient()

  const { data: request, error: requestError } = await supabase
    .from('department_join_requests')
    .select('*')
    .eq('id', requestId)
    .single()

  if (requestError || !request) {
    throw new Error('Join request not found')
  }

  if (request.status !== 'PENDING') {
    throw new Error('Join request already processed')
  }

  const allowed = (await isSuperAdmin()) || (await isDepartmentModerator(request.department_id))
  if (!allowed) {
    throw new Error('Not authorized to reject this request')
  }

  const { error: updateError } = await supabase
    .from('department_join_requests')
    .update({
      status: 'REJECTED',
      decided_at: new Date().toISOString(),
      decided_by: userId,
    })
    .eq('id', requestId)

  if (updateError) {
    throw new Error(`Failed to reject join request: ${updateError.message}`)
  }

  revalidatePath('/admin')
  return { success: true }
}

export async function getOrganizationsForJoin() {
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .order('name')

  if (error) {
    throw new Error(`Failed to fetch organizations: ${error.message}`)
  }

  return data || []
}

export async function getDepartmentsForOrg(orgId: string) {
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, org_id')
    .eq('org_id', orgId)
    .order('name')

  if (error) {
    throw new Error(`Failed to fetch departments: ${error.message}`)
  }

  return data || []
}
