/**
 * Pure rota moderation decision (spec/14, spec/07). lib/rota/access.ts
 * gathers the facts from trusted server-side lookups; this module decides.
 *
 * Deliberately stricter than decideDepartmentModerator (lib/department-authz):
 * super-admin status is NOT an input, so it can never grant access to
 * per-person rota data. Only, within the department's own organisation (which
 * must be the caller's current organisation):
 * - an org admin of that organisation; or
 * - a department_members moderator row whose org_id matches it.
 */

export interface RotaModeratorFacts {
  /** The department's owning organisation (server lookup), or null if missing. */
  departmentOrgId: string | null
  /** The caller's current organisation, or null. */
  currentOrgId: string | null
  /** Whether the caller is org_admin of currentOrgId. */
  orgAdminOfCurrentOrg: boolean
  /** org_id values of the caller's moderator rows for this department. */
  moderatorRowOrgIds: readonly string[]
}

export type RotaModeratorDecision = { allowed: true; orgId: string } | { allowed: false; orgId: null }

const DENY: RotaModeratorDecision = { allowed: false, orgId: null }

export function decideRotaModerator(f: RotaModeratorFacts): RotaModeratorDecision {
  const departmentOrgId = f.departmentOrgId
  if (!departmentOrgId) return DENY
  if (!f.currentOrgId || f.currentOrgId !== departmentOrgId) return DENY
  if (f.orgAdminOfCurrentOrg) return { allowed: true, orgId: departmentOrgId }
  if (f.moderatorRowOrgIds.includes(departmentOrgId)) return { allowed: true, orgId: departmentOrgId }
  return DENY
}
