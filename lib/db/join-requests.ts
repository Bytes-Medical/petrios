import type { UserRole } from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface DepartmentJoinRequest {
  id: string
  org_id: string
  department_id: string
  user_id: string
  user_email: string
  requested_role: UserRole
  status: JoinRequestStatus
  created_at: string
  decided_at: string | null
  decided_by: string | null
}

export interface DepartmentJoinRequestWithRelations extends DepartmentJoinRequest {
  departments: { id: string; name: string } | null
  organizations: { id: string; name: string } | null
}

export async function insertDepartmentJoinRequest(input: {
  orgId: string
  departmentId: string
  userId: string
  userEmail: string
  requestedRole: UserRole
}): Promise<DepartmentJoinRequest> {
  const db = await getDb()
  const { data, error } = await db
    .from('department_join_requests')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      user_id: input.userId,
      user_email: input.userEmail,
      requested_role: input.requestedRole,
      status: 'PENDING',
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to create join request', error)
  return data as DepartmentJoinRequest
}

export async function listPendingJoinRequests(options: {
  service?: boolean
} = {}): Promise<DepartmentJoinRequestWithRelations[]> {
  const db = options.service ? await getServiceDb() : await getDb()
  const { data, error } = await db
    .from('department_join_requests')
    .select(
      '*, departments:department_id (id, name), organizations:org_id (id, name)'
    )
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })

  if (error) throw toDbError('Failed to fetch join requests', error)
  return (data as DepartmentJoinRequestWithRelations[] | null) ?? []
}

export async function findJoinRequest(
  id: string
): Promise<DepartmentJoinRequest | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_join_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to load join request', error)
  return (data as DepartmentJoinRequest | null) ?? null
}

/**
 * Decides a PENDING request (compare-and-set on status). Returns false when
 * the request was already decided, so a concurrent second decision never
 * re-runs the membership writes.
 */
export async function updateJoinRequestStatus(input: {
  id: string
  status: Exclude<JoinRequestStatus, 'PENDING'>
  decidedBy: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_join_requests')
    .update({
      status: input.status,
      decided_at: new Date().toISOString(),
      decided_by: input.decidedBy,
    })
    .eq('id', input.id)
    .eq('status', 'PENDING')
    .select('id')

  if (error) throw toDbError(`Failed to ${input.status.toLowerCase()} join request`, error)
  return ((data as { id: string }[] | null) ?? []).length > 0
}

// -----------------------------------------------------------------------------
// Small convenience reads for the public join page
// -----------------------------------------------------------------------------

export async function listOrganizationsForJoin(): Promise<{ id: string; name: string }[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('organizations')
    .select('id, name')
    .order('name')

  if (error) throw toDbError('Failed to fetch organizations', error)
  return (data as { id: string; name: string }[] | null) ?? []
}

export async function listDepartmentsForJoin(
  orgId: string
): Promise<{ id: string; name: string; org_id: string }[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('departments')
    .select('id, name, org_id')
    .eq('org_id', orgId)
    .order('name')

  if (error) throw toDbError('Failed to fetch departments', error)
  return (data as { id: string; name: string; org_id: string }[] | null) ?? []
}
