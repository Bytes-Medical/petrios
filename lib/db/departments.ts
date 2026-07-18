import type {
  Department,
  DepartmentFeedbackField,
  DepartmentMember,
  UserRole,
} from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { DbNotFoundError, toDbError } from './errors'

// -----------------------------------------------------------------------------
// Departments
// -----------------------------------------------------------------------------

export async function insertDepartment(input: {
  orgId: string
  name: string
  createdBy: string
}): Promise<Department> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .insert({
      org_id: input.orgId,
      name: input.name,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to create department', error)
  return data as Department
}

export async function listDepartmentsByOrg(orgId: string): Promise<Department[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .select('*')
    .eq('org_id', orgId)
    .order('name')

  if (error) throw toDbError('Failed to list departments', error)
  return (data as Department[] | null) ?? []
}

export async function findDepartment(
  id: string,
  orgId: string
): Promise<Department | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department', error)
  return (data as Department | null) ?? null
}

export async function getDepartmentOrThrow(
  id: string,
  orgId: string
): Promise<Department> {
  const row = await findDepartment(id, orgId)
  if (!row) throw new DbNotFoundError(`Department ${id} not found`)
  return row
}

/**
 * Public read of a department (name + feedback form template) without an
 * org filter. Used by the public, accountless feedback page; no authorization needed
 * because the surface is public-by-design.
 */
export async function findDepartmentPublic(
  id: string
): Promise<{ name: string; feedback_form_fields: unknown } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('name, feedback_form_fields')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department (public)', error)
  return (
    (data as { name: string; feedback_form_fields: unknown } | null) ?? null
  )
}

/**
 * Looks up a department's owning org without requiring the caller to know it.
 * Uses a service-role client because this runs during flows (leave, remove
 * member) where the user's own org context may be different from the target.
 * Callers must still verify authorization before invoking.
 */
export async function findDepartmentOrgId(id: string): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('org_id')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up department org', error)
  return (data as { org_id: string } | null)?.org_id ?? null
}

export interface DepartmentSettingsRow {
  leadName: string | null
  coordinatorNames: string[]
  feedbackFormFields: unknown
}

export async function findDepartmentCertificateSettings(
  departmentId: string
): Promise<{
  name: string
  lead_name: string | null
  certificate_coordinator_names: string[]
} | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .select('name, lead_name, certificate_coordinator_names')
    .eq('id', departmentId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department certificate settings', error)
  return (
    (data as {
      name: string
      lead_name: string | null
      certificate_coordinator_names: string[]
    } | null) ?? null
  )
}

export async function findDepartmentSettings(
  departmentId: string,
  orgId: string
): Promise<DepartmentSettingsRow | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .select('lead_name, certificate_coordinator_names, feedback_form_fields')
    .eq('id', departmentId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department settings', error)
  if (!data) return null

  const row = data as {
    lead_name: string | null
    certificate_coordinator_names: string[] | null
    feedback_form_fields: unknown
  }
  return {
    leadName: row.lead_name ?? null,
    coordinatorNames: row.certificate_coordinator_names ?? [],
    feedbackFormFields: row.feedback_form_fields ?? null,
  }
}

export async function updateDepartmentCertificateCoordinators(
  departmentId: string,
  orgId: string,
  coordinatorNames: string[]
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('departments')
    .update({
      certificate_coordinator_names: coordinatorNames,
      // Keep the historical single-value column coherent for older clients.
      lead_name: coordinatorNames[0] ?? null,
    })
    .eq('id', departmentId)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to update certificate coordinators', error)
}

export async function updateDepartmentFeedbackFormFields(
  departmentId: string,
  orgId: string,
  fields: DepartmentFeedbackField[]
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('departments')
    .update({ feedback_form_fields: fields })
    .eq('id', departmentId)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to update feedback fields', error)
}

// -----------------------------------------------------------------------------
// Department members
// -----------------------------------------------------------------------------

export async function insertDepartmentMember(input: {
  orgId: string
  departmentId: string
  userId: string
  role: UserRole
}): Promise<DepartmentMember> {
  const db = await getDb()
  const { data, error } = await db
    .from('department_members')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      user_id: input.userId,
      role: input.role,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to add department member', error)
  return data as DepartmentMember
}

export async function listDepartmentMembers(
  orgId: string,
  departmentId: string
): Promise<DepartmentMember[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('department_members')
    .select('*')
    .eq('org_id', orgId)
    .eq('department_id', departmentId)

  if (error) throw toDbError('Failed to list department members', error)
  return (data as DepartmentMember[] | null) ?? []
}

/** Batched id -> name lookup (service-role; used to enrich slot/session views). */
export async function listDepartmentNames(
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('id, name')
    .in('id', Array.from(new Set(ids)))

  if (error) throw toDbError('Failed to fetch department names', error)
  return new Map(
    ((data as { id: string; name: string }[] | null) ?? []).map((d) => [d.id, d.name])
  )
}

/** Service-role count for audience previews; caller gates authorization. */
export async function countDepartmentMembers(departmentId: string): Promise<number> {
  const db = await getServiceDb()
  const { count, error } = await db
    .from('department_members')
    .select('id', { count: 'exact', head: true })
    .eq('department_id', departmentId)

  if (error) throw toDbError('Failed to count department members', error)
  return count ?? 0
}

/**
 * Returns the user ids of every member of a department, regardless of role.
 * Uses a service-role client so it can run in flows where the current user
 * context may not cover the target department. Authorization is the
 * caller's responsibility.
 */
export async function listDepartmentMemberUserIds(
  departmentId: string
): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_members')
    .select('user_id')
    .eq('department_id', departmentId)

  if (error) throw toDbError('Failed to list department member user ids', error)
  return ((data as { user_id: string }[] | null) ?? []).map((row) => row.user_id)
}

/**
 * Returns the departments for which a user is a moderator (`department_admin`)
 * within a specific org. The embedded `departments:department_id` join is
 * flattened so callers get a simple `{ id, name }[]`.
 */
export async function listModeratedDepartments(
  userId: string,
  orgId: string
): Promise<{ id: string; name: string; department_code: string }[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('department_members')
    .select('departments:department_id (id, name, department_code)')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('role', 'department_admin')

  if (error) throw toDbError('Failed to list moderated departments', error)

  type Row = {
    departments:
      | { id: string; name: string; department_code: string }
      | { id: string; name: string; department_code: string }[]
      | null
  }

  const rows = (data as Row[] | null) ?? []
  return rows.flatMap((row) => {
    if (!row.departments) return []
    return Array.isArray(row.departments) ? row.departments : [row.departments]
  })
}

export async function deleteDepartmentMember(
  departmentId: string,
  userId: string
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('department_members')
    .delete()
    .eq('department_id', departmentId)
    .eq('user_id', userId)

  if (error) throw toDbError('Failed to remove department member', error)
}

export async function deleteOrgMember(
  orgId: string,
  userId: string
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('organization_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId)

  if (error) throw toDbError('Failed to remove organization member', error)
}

export interface DepartmentMemberWithProfile {
  user_id: string
  role: UserRole
  grade: string | null
  created_at: string
  email: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
}

/** Service-role: member management view joins memberships with profiles. */
export async function listDepartmentMembersWithProfiles(
  orgId: string,
  departmentId: string
): Promise<DepartmentMemberWithProfile[]> {
  const db = await getServiceDb()

  const { data: members, error: memError } = await db
    .from('department_members')
    .select('user_id, role, grade, created_at')
    .eq('department_id', departmentId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  if (memError) throw toDbError('Failed to fetch department members', memError)
  if (!members || members.length === 0) return []

  const userIds = (members as { user_id: string }[]).map((m) => m.user_id)
  const { data: profiles, error: profError } = await db
    .from('profiles')
    .select('user_id, email, full_name, first_name, last_name')
    .in('user_id', userIds)

  if (profError) throw toDbError('Failed to fetch member profiles', profError)
  const profileMap = new Map(
    ((profiles as { user_id: string; email: string; full_name: string | null; first_name: string | null; last_name: string | null }[] | null) ?? []).map((p) => [p.user_id, p])
  )

  return (members as { user_id: string; role: UserRole; grade: string | null; created_at: string }[]).map((m) => {
    const profile = profileMap.get(m.user_id)
    return {
      ...m,
      email: profile?.email ?? '',
      full_name: profile?.full_name ?? null,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
    }
  })
}
