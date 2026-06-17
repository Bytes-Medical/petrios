import { createSupabaseClient } from '@/lib/supabase/server'
import { cache } from 'react'

export type UserRole = 'org_admin' | 'department_admin' | 'faculty' | 'trainee'

const getCurrentUserCached = cache(async () => {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
})

const getCurrentOrgMembershipCached = cache(async () => {
  const user = await getCurrentUserCached()
  if (!user) return null

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('Failed to fetch current organization membership:', error.message)
    return null
  }

  return data?.[0] || null
})

export async function getCurrentUser() {
  return getCurrentUserCached()
}

export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser()
  return user?.id || null
}

export async function getCurrentOrgId(): Promise<string | null> {
  const membership = await getCurrentOrgMembershipCached()
  return membership?.org_id || null
}

export async function requireAuth() {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error('Unauthorized')
  }
  return userId
}

export async function requireOrg() {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    throw new Error('Organization required')
  }
  return orgId
}

/** True when the current (or given) org is an auto-provisioned personal
 *  workspace for an individual user, rather than an enterprise organization. */
export async function isPersonalWorkspace(orgId?: string): Promise<boolean> {
  const resolvedOrgId = orgId || (await getCurrentOrgId())
  if (!resolvedOrgId) return false

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('is_personal')
    .eq('id', resolvedOrgId)
    .maybeSingle()

  if (error) return false
  return !!data?.is_personal
}

export async function isOrgAdmin(orgId?: string) {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const resolvedOrgId = orgId || await getCurrentOrgId()

  if (!userId || !resolvedOrgId) return false

  const { data, error } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', resolvedOrgId)
    .eq('role', 'org_admin')
    .maybeSingle()

  if (error) {
    return false
  }

  return !!data
}

export async function isOrgManager(orgId?: string) {
  if (await isSuperAdmin()) return true

  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const resolvedOrgId = orgId || await getCurrentOrgId()

  if (!userId || !resolvedOrgId) return false

  const { data: orgAdmin } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', resolvedOrgId)
    .eq('role', 'org_admin')
    .maybeSingle()

  if (orgAdmin) return true

  const { data: departmentAdmin } = await supabase
    .from('department_members')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', resolvedOrgId)
    .eq('role', 'department_admin')
    .maybeSingle()

  return !!departmentAdmin
}

export async function isSuperAdmin() {
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('super_admins')
    .select('user_id')
    .eq('user_id', (await getCurrentUserId()) || '')
    .single()

  if (error) {
    return false
  }

  return !!data
}

export async function requireSuperAdmin() {
  const isAdmin = await isSuperAdmin()
  if (!isAdmin) {
    throw new Error('Super admin required')
  }
  return true
}

export async function isDepartmentModerator(departmentId: string) {
  if (await isSuperAdmin()) return true
  if (await isOrgAdmin()) return true

  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  if (!userId) return false

  const { data, error } = await supabase
    .from('department_members')
    .select('id')
    .eq('department_id', departmentId)
    .eq('user_id', userId)
    .in('role', ['department_admin', 'org_admin'])
    .maybeSingle()

  if (error) {
    return false
  }

  return !!data
}

export async function requireDepartmentModerator(departmentId: string) {
  const allowed = await isDepartmentModerator(departmentId)
  if (!allowed) {
    throw new Error('Department moderator required')
  }
  return true
}

export async function requireOrgManager(orgId?: string) {
  const allowed = await isOrgManager(orgId)
  if (!allowed) {
    throw new Error('Organization manager required')
  }
  return true
}
