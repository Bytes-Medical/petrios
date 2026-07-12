import type { UserRole } from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Super-admin DAL. Everything here uses the service-role client because
 * super admin actions deliberately span orgs. Callers must gate on
 * `requireSuperAdmin()` before reaching the DAL.
 *
 * We keep organisations / departments reads here (rather than in their own
 * modules) specifically for the super-admin context — global lists that
 * bypass org scoping.
 */

// -----------------------------------------------------------------------------
// Organisation / department global lists
// -----------------------------------------------------------------------------

export async function insertOrganizationAsUser(input: {
  name: string
  createdBy: string
}): Promise<{ id: string; name: string; created_by: string; created_at: string }> {
  const db = await getDb()
  const id = crypto.randomUUID()
  const { data, error } = await db
    .from('organizations')
    .insert({ id, name: input.name, created_by: input.createdBy })
    .select()
    .single()

  if (error) throw toDbError('Failed to create organization', error)
  return data as { id: string; name: string; created_by: string; created_at: string }
}

export async function insertOrganizationMemberAsUser(input: {
  orgId: string
  userId: string
  role: UserRole
}): Promise<void> {
  const db = await getDb()
  const { error } = await db.from('organization_members').insert({
    id: crypto.randomUUID(),
    org_id: input.orgId,
    user_id: input.userId,
    role: input.role,
  })

  if (error) throw toDbError('Failed to add organization member', error)
}

export async function insertDepartmentForOrg(input: {
  orgId: string
  name: string
  createdBy: string
}): Promise<{ id: string; name: string; org_id: string }> {
  const db = await getServiceDb()
  const id = crypto.randomUUID()
  const { data, error } = await db
    .from('departments')
    .insert({
      id,
      org_id: input.orgId,
      name: input.name,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to create department', error)
  return data as { id: string; name: string; org_id: string }
}

export async function listAllOrganizations(): Promise<{ id: string; name: string }[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('organizations')
    .select('id, name')
    .order('name')

  if (error) throw toDbError('Failed to fetch organizations', error)
  return (data as { id: string; name: string }[] | null) ?? []
}

export async function listAllDepartments(): Promise<
  { id: string; name: string; org_id: string }[]
> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('id, name, org_id')
    .order('name')

  if (error) throw toDbError('Failed to fetch departments', error)
  return (data as { id: string; name: string; org_id: string }[] | null) ?? []
}

export async function deleteOrganizationById(orgId: string): Promise<void> {
  const db = await getDb()
  const { error } = await db.from('organizations').delete().eq('id', orgId)
  if (error) throw toDbError('Failed to delete organization', error)
}

export async function deleteDepartmentById(departmentId: string): Promise<void> {
  const db = await getDb()
  const { error } = await db.from('departments').delete().eq('id', departmentId)
  if (error) throw toDbError('Failed to delete department', error)
}

// -----------------------------------------------------------------------------
// Super admin role table
// -----------------------------------------------------------------------------

export async function listSuperAdmins(): Promise<{ user_id: string }[]> {
  const db = await getServiceDb()
  const { data, error } = await db.from('super_admins').select('user_id')
  if (error) throw toDbError('Failed to fetch super admins', error)
  return (data as { user_id: string }[] | null) ?? []
}

export async function upsertSuperAdmin(userId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('super_admins')
    .upsert({ user_id: userId }, { onConflict: 'user_id' })
  if (error) throw toDbError('Failed to grant super admin', error)
}

export async function deleteSuperAdmin(userId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('super_admins').delete().eq('user_id', userId)
  if (error) throw toDbError('Failed to revoke super admin', error)
}

// -----------------------------------------------------------------------------
// Cross-org membership listings
// -----------------------------------------------------------------------------

export async function listAllDepartmentMemberships(): Promise<unknown[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_members')
    .select(
      'user_id, role, department_id, departments:department_id (id, name, org_id)'
    )
  if (error) throw toDbError('Failed to fetch department memberships', error)
  return (data as unknown[] | null) ?? []
}

export async function listAllOrganizationMemberships(): Promise<unknown[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organization_members')
    .select('user_id, role, org_id, organizations:org_id (id, name)')
  if (error) throw toDbError('Failed to fetch organization memberships', error)
  return (data as unknown[] | null) ?? []
}

// -----------------------------------------------------------------------------
// Department moderator grants
// -----------------------------------------------------------------------------

export async function findDepartmentOrg(
  departmentId: string
): Promise<{ org_id: string } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('org_id')
    .eq('id', departmentId)
    .maybeSingle()
  if (error) throw toDbError('Failed to load department', error)
  return (data as { org_id: string } | null) ?? null
}

export async function deleteDepartmentModeratorRole(input: {
  departmentId: string
  userId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('department_members')
    .delete()
    .eq('department_id', input.departmentId)
    .eq('user_id', input.userId)
    .eq('role', 'department_admin')

  if (error) throw toDbError('Failed to revoke moderator', error)
}

/**
 * Service-role: super-admin user deletion removes membership + profile rows
 * before the auth-plane account delete (cascades don't reach auth.users).
 */
export async function deleteUserDataRows(userId: string): Promise<void> {
  const db = await getServiceDb()

  const memberships = await db.from('department_members').delete().eq('user_id', userId)
  if (memberships.error) throw toDbError('Failed to remove department memberships', memberships.error)

  const orgs = await db.from('organization_members').delete().eq('user_id', userId)
  if (orgs.error) throw toDbError('Failed to remove organization memberships', orgs.error)

  const profiles = await db.from('profiles').delete().eq('user_id', userId)
  if (profiles.error) throw toDbError('Failed to remove profile', profiles.error)
}

export interface DepartmentWithOrgName {
  id: string
  name: string
  org_id: string
  org_name: string
}

/** Service-role: super-admin moderator provisioning spans organizations. */
export async function findDepartmentWithOrgName(
  departmentId: string
): Promise<DepartmentWithOrgName | null> {
  const db = await getServiceDb()

  const { data, error } = await db
    .from('departments')
    .select('id, name, org_id, organizations:org_id(name)')
    .eq('id', departmentId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch department', error)
  if (!data) return null

  const row = data as { id: string; name: string; org_id: string; organizations: { name: string } | { name: string }[] | null }
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
  return { id: row.id, name: row.name, org_id: row.org_id, org_name: org?.name ?? 'Unknown' }
}
