import { createSupabaseClient } from '@/lib/supabase/server'

export type UserRole = 'org_admin' | 'department_admin' | 'faculty' | 'trainee'

export async function getCurrentUser() {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser()
  return user?.id || null
}

export async function getCurrentOrgId(): Promise<string | null> {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  if (!userId) return null

  const { data } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .single()

  return data?.org_id || null
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

export async function isOrgAdmin() {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  if (!userId) return false

  const { data, error } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'org_admin')
    .maybeSingle()

  if (error) {
    return false
  }

  return !!data
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

  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  if (!userId) return false

  const { data: orgAdmin } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'org_admin')
    .maybeSingle()

  if (orgAdmin) {
    return true
  }

  const { data, error } = await supabase
    .from('department_members')
    .select('id')
    .eq('department_id', departmentId)
    .eq('user_id', userId)
    .in('role', ['department_admin', 'org_admin'])
    .single()

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
