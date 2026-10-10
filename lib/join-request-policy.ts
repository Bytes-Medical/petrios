import type { UserRole } from '@/lib/types'

/**
 * Policy for the legacy department join-request flow. A requester can only
 * ask for an ordinary membership, and an approval grants at most that: the
 * role comes from the stored request (never from the approving client), and
 * moderator or admin roles are granted through member management instead.
 */
export const JOIN_REQUESTABLE_ROLES = ['trainee', 'faculty'] as const
export type JoinRequestableRole = (typeof JOIN_REQUESTABLE_ROLES)[number]

export function isJoinRequestableRole(role: unknown): role is JoinRequestableRole {
  return (
    typeof role === 'string' &&
    (JOIN_REQUESTABLE_ROLES as readonly string[]).includes(role)
  )
}

/** Role an approval grants: the requested ordinary role, else trainee. */
export function joinRequestGrantRole(
  requestedRole: UserRole | string | null | undefined
): JoinRequestableRole {
  return isJoinRequestableRole(requestedRole) ? requestedRole : 'trainee'
}

export type JoinRequestBindingError = 'department-missing' | 'org-mismatch'

/**
 * A join request names an organisation and a department; both came from the
 * requester's client. It is only actionable when the department (looked up on
 * the server) belongs to the organisation the request would grant.
 */
export function joinRequestBindingError(input: {
  requestOrgId: string
  departmentOrgId: string | null
}): JoinRequestBindingError | null {
  if (!input.departmentOrgId) return 'department-missing'
  if (input.departmentOrgId !== input.requestOrgId) return 'org-mismatch'
  return null
}

const ROLE_RANK: Record<string, number> = {
  trainee: 0,
  faculty: 1,
  department_admin: 2,
  org_admin: 3,
}

/**
 * The role an approval writes over an existing membership: the granted
 * ordinary role, unless the requester already holds a higher one. An
 * approval never demotes (a department moderator approving a request filed
 * by an org admin of the same organisation must not strip that admin role).
 */
export function joinRequestEffectiveRole(
  existingRole: UserRole | string | null | undefined,
  grantedRole: JoinRequestableRole
): UserRole {
  if (existingRole && existingRole in ROLE_RANK && ROLE_RANK[existingRole] > ROLE_RANK[grantedRole]) {
    return existingRole as UserRole
  }
  return grantedRole
}
