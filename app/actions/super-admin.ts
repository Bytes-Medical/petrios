'use server'

import { createSupabaseClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireAuth, requireSuperAdmin } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function createOrganizationAsSuperAdmin(name: string) {
  const userId = await requireAuth()
  await requireSuperAdmin()

  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name,
      created_by: userId,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create organization: ${error.message}`)
  }

  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({
      org_id: data.id,
      user_id: userId,
      role: 'org_admin',
    })

  if (memberError) {
    throw new Error(`Failed to add org admin: ${memberError.message}`)
  }

  revalidatePath('/super-admin')
  return data
}

export async function createDepartmentForOrg(orgId: string, name: string) {
  const userId = await requireAuth()
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()

  const { data, error } = await supabase
    .from('departments')
    .insert({
      org_id: orgId,
      name,
      created_by: userId,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create department: ${error.message}`)
  }

  revalidatePath('/super-admin')
  return data
}

export async function getAllOrganizations() {
  await requireSuperAdmin()

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

export async function getAllDepartments() {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, org_id')
    .order('name')

  if (error) {
    throw new Error(`Failed to fetch departments: ${error.message}`)
  }

  return data || []
}

export async function deleteOrganization(orgId: string) {
  await requireSuperAdmin()

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('organizations')
    .delete()
    .eq('id', orgId)

  if (error) {
    throw new Error(`Failed to delete organization: ${error.message}`)
  }

  revalidatePath('/super-admin')
  return { success: true }
}

export async function deleteDepartment(departmentId: string) {
  await requireSuperAdmin()

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from('departments')
    .delete()
    .eq('id', departmentId)

  if (error) {
    throw new Error(`Failed to delete department: ${error.message}`)
  }

  revalidatePath('/super-admin')
  return { success: true }
}

export async function getAllUsers() {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  })

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`)
  }

  return data.users || []
}

export async function getSuperAdmins() {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('super_admins')
    .select('user_id')

  if (error) {
    throw new Error(`Failed to fetch super admins: ${error.message}`)
  }

  return data || []
}

export async function getAllDepartmentMemberships() {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('department_members')
    .select('user_id, role, department_id, departments:department_id (id, name, org_id)')

  if (error) {
    throw new Error(`Failed to fetch department memberships: ${error.message}`)
  }

  return data || []
}

export async function getAllOrganizationMemberships() {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id, role, org_id, organizations:org_id (id, name)')

  if (error) {
    throw new Error(`Failed to fetch organization memberships: ${error.message}`)
  }

  return data || []
}

export async function grantDepartmentModerator(userId: string, departmentId: string) {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { data: department, error: deptError } = await supabase
    .from('departments')
    .select('org_id')
    .eq('id', departmentId)
    .single()

  if (deptError || !department) {
    throw new Error('Department not found')
  }

  const { error: cleanupDeptError } = await supabase
    .from('department_members')
    .delete()
    .eq('user_id', userId)
    .neq('org_id', department.org_id)

  if (cleanupDeptError) {
    throw new Error(`Failed to remove previous department memberships: ${cleanupDeptError.message}`)
  }

  const { error: cleanupOrgError } = await supabase
    .from('organization_members')
    .delete()
    .eq('user_id', userId)
    .neq('org_id', department.org_id)

  if (cleanupOrgError) {
    throw new Error(`Failed to remove previous organization memberships: ${cleanupOrgError.message}`)
  }

  const { error: orgMemberError } = await supabase
    .from('organization_members')
    .upsert({
      org_id: department.org_id,
      user_id: userId,
      role: 'department_admin',
    }, { onConflict: 'org_id,user_id' })

  if (orgMemberError) {
    throw new Error(`Failed to add organization member: ${orgMemberError.message}`)
  }

  const { error: memberError } = await supabase
    .from('department_members')
    .upsert({
      org_id: department.org_id,
      department_id: departmentId,
      user_id: userId,
      role: 'department_admin',
    }, { onConflict: 'department_id,user_id' })

  if (memberError) {
    throw new Error(`Failed to grant moderator: ${memberError.message}`)
  }

  revalidatePath('/super-admin')
  return { success: true }
}

export async function revokeDepartmentModerator(userId: string, departmentId: string) {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { error: memberError } = await supabase
    .from('department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', userId)
    .eq('role', 'department_admin')

  if (memberError) {
    throw new Error(`Failed to revoke moderator: ${memberError.message}`)
  }

  revalidatePath('/super-admin')
  return { success: true }
}

export async function grantSuperAdmin(userId: string) {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { error } = await supabase
    .from('super_admins')
    .upsert({ user_id: userId }, { onConflict: 'user_id' })

  if (error) {
    throw new Error(`Failed to grant super admin: ${error.message}`)
  }

  revalidatePath('/super-admin')
  return { success: true }
}

export async function revokeSuperAdmin(userId: string) {
  await requireSuperAdmin()

  const supabase = await createSupabaseServiceClient()
  const { error } = await supabase
    .from('super_admins')
    .delete()
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to revoke super admin: ${error.message}`)
  }

  revalidatePath('/super-admin')
  return { success: true }
}
