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

// Role checks below are cache()-deduped per request (cache keys on args) and
// issue their queries CONCURRENTLY. A page plus its actions may check the
// same role many times per request; latency beats query count, so we accept
// running a query whose sibling would have short-circuited it.

const isOrgAdminCached = cache(async (orgId: string | undefined) => {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const resolvedOrgId = orgId || (await getCurrentOrgId())

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
})

export async function isOrgAdmin(orgId?: string) {
  return isOrgAdminCached(orgId)
}

const isOrgManagerCached = cache(async (orgId: string | undefined) => {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const resolvedOrgId = orgId || (await getCurrentOrgId())

  if (!userId || !resolvedOrgId) return isSuperAdmin()

  const [superAdmin, orgAdmin, departmentAdmin] = await Promise.all([
    isSuperAdmin(),
    isOrgAdminCached(resolvedOrgId),
    supabase
      .from('department_members')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', resolvedOrgId)
      .eq('role', 'department_admin')
      .maybeSingle()
      .then(({ data }) => !!data),
  ])

  return superAdmin || orgAdmin || departmentAdmin
})

export async function isOrgManager(orgId?: string) {
  return isOrgManagerCached(orgId)
}

const isSuperAdminCached = cache(async () => {
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
})

export async function isSuperAdmin() {
  return isSuperAdminCached()
}

export async function requireSuperAdmin() {
  const isAdmin = await isSuperAdmin()
  if (!isAdmin) {
    throw new Error('Super admin required')
  }
  return true
}

const isDepartmentModeratorCached = cache(async (departmentId: string) => {
  const userId = await getCurrentUserId()
  if (!userId) return isSuperAdmin()

  const supabase = await createSupabaseClient()
  const [superAdmin, orgAdmin, deptModerator] = await Promise.all([
    isSuperAdmin(),
    isOrgAdmin(),
    supabase
      .from('department_members')
      .select('id')
      .eq('department_id', departmentId)
      .eq('user_id', userId)
      .in('role', ['department_admin', 'org_admin'])
      .maybeSingle()
      .then(({ data, error }) => !error && !!data),
  ])

  return superAdmin || orgAdmin || deptModerator
})

export async function isDepartmentModerator(departmentId: string) {
  return isDepartmentModeratorCached(departmentId)
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
