import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Personal-workspace provisioning (auto-created orgs for individual users).
 * Service-role throughout: org creation is otherwise a super-admin-only
 * operation, and the caller (ensurePersonalWorkspace) authorizes by
 * requireAuth + self-scoping.
 */

export async function findOldestMembershipOrgId(userId: string): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up memberships', error)
  return (data as { org_id: string } | null)?.org_id ?? null
}

export async function findOldestDepartmentId(orgId: string): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up departments', error)
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Create the personal org + owner membership + default department +
 * moderator membership. Sequential inserts, loud failures (a half-created
 * workspace is recoverable on the next sign-in because the flow is
 * membership-idempotent).
 */
export async function insertPersonalWorkspace(input: {
  orgId: string
  departmentId: string
  userId: string
  orgName: string
}): Promise<void> {
  const db = await getServiceDb()

  const { error: orgError } = await db
    .from('organizations')
    .insert({ id: input.orgId, name: input.orgName, created_by: input.userId, is_personal: true })
  if (orgError) throw toDbError('Failed to create personal workspace', orgError)

  const { error: memberError } = await db
    .from('organization_members')
    .insert({ org_id: input.orgId, user_id: input.userId, role: 'org_admin' })
  if (memberError) throw toDbError('Failed to add workspace membership', memberError)

  const { error: deptError } = await db
    .from('departments')
    .insert({ id: input.departmentId, org_id: input.orgId, name: 'My Teaching', created_by: input.userId })
  if (deptError) throw toDbError('Failed to create department', deptError)

  const { error: deptMemberError } = await db.from('department_members').insert({
    org_id: input.orgId,
    department_id: input.departmentId,
    user_id: input.userId,
    role: 'department_admin',
  })
  if (deptMemberError) throw toDbError('Failed to add department membership', deptMemberError)
}
