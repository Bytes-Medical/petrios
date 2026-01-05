'use server'

import { createSupabaseClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function createDepartment(name: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

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

  revalidatePath('/departments')
  revalidatePath('/admin')
  return data
}

export async function getDepartments() {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('org_id', orgId)
    .order('name')

  if (error) {
    throw new Error(`Failed to fetch departments: ${error.message}`)
  }

  return data || []
}

export async function getDepartment(id: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()

  if (error) {
    throw new Error(`Failed to fetch department: ${error.message}`)
  }

  return data
}

export async function addDepartmentMember(departmentId: string, userId: string, role: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('department_members')
    .insert({
      org_id: orgId,
      department_id: departmentId,
      user_id: userId,
      role,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to add member: ${error.message}`)
  }

  revalidatePath(`/departments/${departmentId}`)
  revalidatePath('/admin')
  return data
}

export async function getDepartmentMembers(departmentId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('department_members')
    .select('*')
    .eq('org_id', orgId)
    .eq('department_id', departmentId)

  if (error) {
    throw new Error(`Failed to fetch members: ${error.message}`)
  }

  return data || []
}

export async function getDepartmentMemberUsers(departmentId: string) {
  await requireDepartmentModerator(departmentId)

  const supabase = await createSupabaseServiceClient()

  const { data: members, error: membersError } = await supabase
    .from('department_members')
    .select('user_id')
    .eq('department_id', departmentId)

  if (membersError) {
    throw new Error(`Failed to fetch department members: ${membersError.message}`)
  }

  const userIds = (members || []).map(m => m.user_id)
  if (userIds.length === 0) return []

  const users = await Promise.all(
    userIds.map(async userId => {
      const { data, error } = await supabase.auth.admin.getUserById(userId)
      if (error) {
        return { id: userId, email: null }
      }
      return { id: data.user.id, email: data.user.email || null }
    })
  )

  return users
}

export async function getMyModeratedDepartments() {
  const userId = await requireAuth()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('department_members')
    .select('departments:department_id (id, name)')
    .eq('user_id', userId)
    .eq('role', 'department_admin')

  if (error) {
    throw new Error(`Failed to fetch moderated departments: ${error.message}`)
  }

  return (data || []).map(row => row.departments).filter(Boolean) as { id: string; name: string }[]
}

export async function getMyModeratedDepartment() {
  const departments = await getMyModeratedDepartments()
  return departments.length > 0 ? departments[0] : null
}

export async function leaveDepartment(departmentId: string) {
  const userId = await requireAuth()
  const supabase = await createSupabaseServiceClient()

  const { data: department, error: deptError } = await supabase
    .from('departments')
    .select('org_id')
    .eq('id', departmentId)
    .single()

  if (deptError || !department) {
    throw new Error('Department not found')
  }

  const { error: removeDeptError } = await supabase
    .from('department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', userId)

  if (removeDeptError) {
    throw new Error(`Failed to leave department: ${removeDeptError.message}`)
  }

  const { error: removeOrgError } = await supabase
    .from('organization_members')
    .delete()
    .eq('org_id', department.org_id)
    .eq('user_id', userId)

  if (removeOrgError) {
    throw new Error(`Failed to leave organization: ${removeOrgError.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/departments')
  revalidatePath('/admin')
  return { success: true }
}

export async function removeDepartmentMember(departmentId: string, memberUserId: string) {
  await requireDepartmentModerator(departmentId)
  const supabase = await createSupabaseServiceClient()

  const { data: department, error: deptError } = await supabase
    .from('departments')
    .select('org_id')
    .eq('id', departmentId)
    .single()

  if (deptError || !department) {
    throw new Error('Department not found')
  }

  const { error: removeDeptError } = await supabase
    .from('department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', memberUserId)

  if (removeDeptError) {
    throw new Error(`Failed to remove member: ${removeDeptError.message}`)
  }

  const { error: removeOrgError } = await supabase
    .from('organization_members')
    .delete()
    .eq('org_id', department.org_id)
    .eq('user_id', memberUserId)

  if (removeOrgError) {
    throw new Error(`Failed to remove organization member: ${removeOrgError.message}`)
  }

  revalidatePath(`/departments/${departmentId}`)
  revalidatePath('/admin')
  return { success: true }
}
