/**
 * Pure authorization decisions for department-scoped moderation. lib/auth.ts
 * gathers the facts (each from a trusted server-side lookup) and this module
 * decides, so the cross-organisation rules are testable without a database.
 *
 * The rule (spec/07, "Department and session moderation"):
 * - the department must exist; its owning organisation is resolved on the
 *   server, never taken from the client;
 * - a super admin may moderate any department;
 * - everyone else must be working in the department's organisation (their
 *   current org), so every follow-up query the caller scopes with
 *   requireOrg() lines up with the department; and
 * - within that organisation the caller is an org admin of it, or holds a
 *   department_members moderator row whose department AND org_id match.
 */

export interface DepartmentModeratorFacts {
  /** The department's owning organisation, or null when it does not exist. */
  departmentOrgId: string | null
  /** The caller's current organisation (requireOrg), or null. */
  currentOrgId: string | null
  superAdmin: boolean
  /** Whether the caller is org_admin of currentOrgId. */
  orgAdminOfCurrentOrg: boolean
  /**
   * org_id values of the caller's department_members rows for this department
   * with a moderator role. A row whose org_id differs from the department's
   * organisation (planted before the composite foreign key) never counts.
   */
  moderatorRowOrgIds: readonly string[]
}

export type DepartmentModeratorDecision =
  | { allowed: true; orgId: string }
  | { allowed: false; orgId: null }

const DENY: DepartmentModeratorDecision = { allowed: false, orgId: null }

export function decideDepartmentModerator(
  facts: DepartmentModeratorFacts
): DepartmentModeratorDecision {
  const departmentOrgId = facts.departmentOrgId
  if (!departmentOrgId) return DENY

  if (facts.superAdmin) return { allowed: true, orgId: departmentOrgId }

  if (!facts.currentOrgId || facts.currentOrgId !== departmentOrgId) return DENY

  if (facts.orgAdminOfCurrentOrg) return { allowed: true, orgId: departmentOrgId }
  if (facts.moderatorRowOrgIds.includes(departmentOrgId)) {
    return { allowed: true, orgId: departmentOrgId }
  }
  return DENY
}

/**
 * Org-scoped reads that take an organisation id from their caller (server
 * components pass the current org) only serve the caller's current
 * organisation, or any organisation for a super admin.
 */
export function canReadOrgScope(input: {
  requestedOrgId: string
  currentOrgId: string | null
  superAdmin: boolean
}): boolean {
  if (!input.requestedOrgId) return false
  if (input.superAdmin) return true
  return !!input.currentOrgId && input.currentOrgId === input.requestedOrgId
}

/** Department roles a moderator cannot remove through the members panel. */
export const PROTECTED_DEPARTMENT_ROLES: readonly string[] = ['org_admin', 'department_admin']

export type DepartmentMemberRemovalBlock = 'not-a-member' | 'protected-role'

/**
 * Removing a department member also removes their membership of the
 * department's organisation, so the target must be a member of THIS
 * department in THIS organisation, and administrators (by department role or
 * organisation role) are never removable here. Mirrors the members panel,
 * which hides the action for protected roles.
 */
export function departmentMemberRemovalBlock(input: {
  departmentRole: string | null
  orgRole: string | null
  /**
   * Whether the target holds a department_admin row for ANY department of
   * this organisation. Removal also deletes the organisation membership, so
   * without this a moderator of one department could evict a peer moderator
   * of another department who is an ordinary member of theirs.
   */
  moderatesAnyDepartmentInOrg?: boolean
}): DepartmentMemberRemovalBlock | null {
  if (!input.departmentRole) return 'not-a-member'
  if (PROTECTED_DEPARTMENT_ROLES.includes(input.departmentRole)) return 'protected-role'
  if (input.orgRole && PROTECTED_DEPARTMENT_ROLES.includes(input.orgRole)) return 'protected-role'
  if (input.moderatesAnyDepartmentInOrg) return 'protected-role'
  return null
}
