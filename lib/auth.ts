import { createSupabaseClient } from '@/lib/supabase/server'
import { cache } from 'react'
import * as departmentsDb from '@/lib/db/departments'
import * as sessionsDb from '@/lib/db/sessions'
import { DbNotFoundError } from '@/lib/db'
import {
  canReadOrgScope,
  decideDepartmentModerator,
  type DepartmentModeratorDecision,
} from '@/lib/department-authz'

export type UserRole = 'org_admin' | 'department_admin' | 'faculty' | 'trainee'

const getCurrentUserCached = cache(async () => {
  const supabase = await createSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
})

const getCurrentOrgMembershipCached = cache(async () => {
  const user = await getCurrentUserCached()
  if (!user) return null

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error('Failed to fetch current organization membership:', error.message)
    return null
  }

  return data?.[0] || null
})

export async function getCurrentUser() {
  return getCurrentUserCached()
}

export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser()
  return user?.id || null
}

export async function getCurrentOrgId(): Promise<string | null> {
  const membership = await getCurrentOrgMembershipCached()
  return membership?.org_id || null
}

export async function requireAuth() {
  const userId = await getCurrentUserId()
  if (!userId) {
    throw new Error('Unauthorized')
  }
  return userId
}

export async function requireOrg() {
  const orgId = await getCurrentOrgId()
  if (!orgId) {
    throw new Error('Organization required')
  }
  return orgId
}

/** True when the current (or given) org is an auto-provisioned personal
 *  workspace for an individual user, rather than an enterprise organization. */
export async function isPersonalWorkspace(orgId?: string): Promise<boolean> {
  const resolvedOrgId = orgId || (await getCurrentOrgId())
  if (!resolvedOrgId) return false

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('is_personal')
    .eq('id', resolvedOrgId)
    .maybeSingle()

  if (error) return false
  return !!data?.is_personal
}

// Role checks below are cache()-deduped per request (cache keys on args) and
// issue their queries CONCURRENTLY. A page plus its actions may check the
// same role many times per request; latency beats query count, so we accept
// running a query whose sibling would have short-circuited it.

const isOrgAdminCached = cache(async (orgId: string | undefined) => {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const resolvedOrgId = orgId || (await getCurrentOrgId())

  if (!userId || !resolvedOrgId) return false

  const { data, error } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('org_id', resolvedOrgId)
    .eq('role', 'org_admin')
    .maybeSingle()

  if (error) {
    return false
  }

  return !!data
})

export async function isOrgAdmin(orgId?: string) {
  return isOrgAdminCached(orgId)
}

const isOrgManagerCached = cache(async (orgId: string | undefined) => {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const resolvedOrgId = orgId || (await getCurrentOrgId())

  if (!userId || !resolvedOrgId) return isSuperAdmin()

  const [superAdmin, orgAdmin, departmentAdmin] = await Promise.all([
    isSuperAdmin(),
    isOrgAdminCached(resolvedOrgId),
    // Existence check: a moderator of several departments in one org has
    // several rows, which .maybeSingle() would turn into an error (false).
    supabase
      .from('department_members')
      .select('id')
      .eq('user_id', userId)
      .eq('org_id', resolvedOrgId)
      .eq('role', 'department_admin')
      .limit(1)
      .then(({ data, error }) => !error && (data?.length ?? 0) > 0),
  ])

  return superAdmin || orgAdmin || departmentAdmin
})

export async function isOrgManager(orgId?: string) {
  return isOrgManagerCached(orgId)
}

const isSuperAdminCached = cache(async () => {
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from('super_admins')
    .select('user_id')
    .eq('user_id', (await getCurrentUserId()) || '')
    .single()

  if (error) {
    return false
  }

  return !!data
})

export async function isSuperAdmin() {
  return isSuperAdminCached()
}

export async function requireSuperAdmin() {
  const isAdmin = await isSuperAdmin()
  if (!isAdmin) {
    throw new Error('Super admin required')
  }
  return true
}

/**
 * Department moderation (spec/07). The department's owning organisation is
 * resolved on the server (service-role lookup of the department row), never
 * taken from the caller, and decideDepartmentModerator grants only:
 * - a super admin, for any department; or
 * - a caller whose CURRENT organisation is the department's organisation and
 *   who is org_admin of it, or holds a moderator department_members row whose
 *   org_id matches it.
 * All facts are fetched in one concurrent wave.
 */
const resolveDepartmentModeratorCached = cache(
  async (departmentId: string): Promise<DepartmentModeratorDecision> => {
    const userId = await getCurrentUserId()
    if (!userId || !departmentId) return { allowed: false, orgId: null }

    const [departmentOrgId, currentOrgId, superAdmin, orgAdminOfCurrentOrg, moderatorRowOrgIds] =
      await Promise.all([
        departmentsDb.findDepartmentOrgId(departmentId).catch(() => null),
        getCurrentOrgId(),
        isSuperAdmin(),
        getCurrentOrgId().then((orgId) => (orgId ? isOrgAdminCached(orgId) : false)),
        departmentsDb
          .listDepartmentModeratorOrgIds(userId, departmentId)
          .catch(() => [] as string[]),
      ])

    return decideDepartmentModerator({
      departmentOrgId,
      currentOrgId,
      superAdmin,
      orgAdminOfCurrentOrg,
      moderatorRowOrgIds,
    })
  }
)

export async function isDepartmentModerator(departmentId: string) {
  return (await resolveDepartmentModeratorCached(departmentId)).allowed
}

/**
 * Throws unless the caller may moderate the department, and returns the
 * department's organisation id. Callers scope every follow-up read and
 * write with this `orgId` (it equals requireOrg() for everyone except a
 * super admin acting in another organisation).
 */
export async function requireDepartmentModerator(
  departmentId: string
): Promise<{ orgId: string }> {
  const decision = await resolveDepartmentModeratorCached(departmentId)
  if (!decision.allowed) {
    throw new Error('Department moderator required')
  }
  return { orgId: decision.orgId }
}

/**
 * Session-level equivalent: the session is looked up inside the caller's
 * current organisation first, then its department is checked with
 * requireDepartmentModerator.
 */
export async function requireSessionModerator(sessionId: string): Promise<{
  orgId: string
  departmentId: string
}> {
  const orgId = await requireOrg()
  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }
  const decision = await requireDepartmentModerator(scope.department_id)
  if (decision.orgId !== orgId) {
    // Unreachable once migration 062's composite key holds; a session whose
    // department belongs to another organisation is never moderatable.
    throw new Error('Department moderator required')
  }
  return { orgId, departmentId: scope.department_id }
}

/**
 * For org-scoped reads that receive an organisation id from a server
 * component: only the caller's current organisation (or any, for a super
 * admin) is served.
 */
export async function requireOrgScope(orgId: string): Promise<string> {
  const [currentOrgId, superAdmin] = await Promise.all([getCurrentOrgId(), isSuperAdmin()])
  if (!canReadOrgScope({ requestedOrgId: orgId, currentOrgId, superAdmin })) {
    throw new Error('Organization access denied')
  }
  return orgId
}

export async function requireOrgManager(orgId?: string) {
  const allowed = await isOrgManager(orgId)
  if (!allowed) {
    throw new Error('Organization manager required')
  }
  return true
}
