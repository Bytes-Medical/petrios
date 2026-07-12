import type { UserRole } from '@/lib/types'
import { getDb } from './client'
import { DbNotFoundError, toDbError } from './errors'

export interface Organization {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface OrganizationMember {
  id: string
  org_id: string
  user_id: string
  role: UserRole
  created_at: string
}

export interface OrganizationMembershipWithOrg {
  id: string
  org_id: string
  user_id: string
  role: UserRole
  created_at: string
  organizations: Organization | null
}

// -----------------------------------------------------------------------------
// Organizations
// -----------------------------------------------------------------------------

export async function insertOrganization(input: {
  name: string
  createdBy: string
}): Promise<Organization> {
  const db = await getDb()
  const { data, error } = await db
    .from('organizations')
    .insert({
      name: input.name,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to create organization', error)
  return data as Organization
}

export async function findOrganization(id: string): Promise<Organization | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('organizations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch organization', error)
  return (data as Organization | null) ?? null
}

export async function getOrganizationOrThrow(id: string): Promise<Organization> {
  const row = await findOrganization(id)
  if (!row) throw new DbNotFoundError(`Organization ${id} not found`)
  return row
}

// -----------------------------------------------------------------------------
// Organization members
// -----------------------------------------------------------------------------

export async function insertOrganizationMember(input: {
  orgId: string
  userId: string
  role: UserRole
}): Promise<void> {
  const db = await getDb()
  const { error } = await db.from('organization_members').insert({
    org_id: input.orgId,
    user_id: input.userId,
    role: input.role,
  })

  if (error) throw toDbError('Failed to add organization member', error)
}

export async function findOrganizationNamePublic(
  orgId: string
): Promise<string | null> {
  const { getServiceDb } = await import('./client')
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch organization name', error)
  return (data as { name: string } | null)?.name ?? null
}

export async function findOrganizationName(orgId: string): Promise<string | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch organization name', error)
  return (data as { name: string } | null)?.name ?? null
}

// -----------------------------------------------------------------------------
// Membership role checks (used by NavShell / admin link resolver)
// -----------------------------------------------------------------------------

export async function userIsOrgAdminAnywhere(userId: string): Promise<boolean> {
  const db = await getDb()
  const { data, error } = await db
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'org_admin')
    .maybeSingle()

  if (error) throw toDbError('Failed to check org admin membership', error)
  return !!data
}

export async function userIsDepartmentAdminAnywhere(userId: string): Promise<boolean> {
  const db = await getDb()
  const { data, error } = await db
    .from('department_members')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'department_admin')
    .maybeSingle()

  if (error) throw toDbError('Failed to check department admin membership', error)
  return !!data
}

export async function listMyOrganizations(
  userId: string
): Promise<OrganizationMembershipWithOrg[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('organization_members')
    .select('*, organizations:org_id (*)')
    .eq('user_id', userId)

  if (error) throw toDbError('Failed to list organizations', error)
  return (data as OrganizationMembershipWithOrg[] | null) ?? []
}

/** Service-role: /api/health db-reachability probe (no user session). */
export async function pingDatabase(): Promise<boolean> {
  try {
    const { getServiceDb } = await import('./client')
    const db = await getServiceDb()
    const { error } = await db
      .from('organizations')
      .select('id', { count: 'exact', head: true })
    return !error
  } catch {
    return false
  }
}
