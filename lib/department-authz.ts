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
