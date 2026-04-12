import type {
  DepartmentInviteLink,
  OnboardingLinkType,
  OnboardingRequestStatus,
  Profile,
  UserRole,
} from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Onboarding DAL — covers the invite-link + onboarding-request flow plus the
 * multi-org cleanup / upsert operations that happen when a user is joining
 * an organization through a department invite.
 *
 * Much of the onboarding action file is on the auth plane (`auth.admin.*`)
 * and stays there; this DAL only owns the data-plane portion.
 */

// -----------------------------------------------------------------------------
// Department invite links
// -----------------------------------------------------------------------------

export interface InviteLookupRecord {
  id: string
  org_id: string
  department_id: string
  invite_code: string
  departments: { id: string; name: string } | null
  organizations: { id: string; name: string } | null
}

export async function findInviteByCode(
  inviteCode: string
): Promise<InviteLookupRecord | null> {
  const db = await getServiceDb()
  const normalizedCode = inviteCode.trim().toUpperCase()

  const { data, error } = await db
    .from('department_invite_links')
    .select(
      'id, org_id, department_id, invite_code, departments:department_id(id, name), organizations:org_id(id, name)'
    )
    .eq('invite_code', normalizedCode)
    .maybeSingle()

  if (error) throw toDbError('Failed to resolve invite link', error)

  if (!data) return null

  // Flatten any array-embed responses so callers always get a single object.
  type Row = {
    id: string
    org_id: string
    department_id: string
    invite_code: string
    departments: { id: string; name: string } | { id: string; name: string }[] | null
    organizations:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null
  }
  const row = data as Row
  const flatten = <T>(value: T | T[] | null): T | null => {
    if (!value) return null
    return Array.isArray(value) ? value[0] ?? null : value
  }
  return {
    id: row.id,
    org_id: row.org_id,
    department_id: row.department_id,
    invite_code: row.invite_code,
    departments: flatten(row.departments),
    organizations: flatten(row.organizations),
  }
}

export async function listInviteLinkDepartmentIds(
  departmentIds: string[]
): Promise<string[]> {
  if (departmentIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_invite_links')
    .select('department_id')
    .in('department_id', departmentIds)

  if (error) throw toDbError('Failed to load invite links', error)
  return ((data as { department_id: string }[] | null) ?? []).map(
    (row) => row.department_id
  )
}

export async function insertInviteLinksForDepartments(
  rows: { orgId: string; departmentId: string; createdBy: string | null }[]
): Promise<void> {
  if (rows.length === 0) return
  const db = await getServiceDb()
  const { error } = await db.from('department_invite_links').insert(
    rows.map((row) => ({
      org_id: row.orgId,
      department_id: row.departmentId,
      created_by: row.createdBy,
    }))
  )

  if (error) throw toDbError('Failed to initialize invite links', error)
}

export async function listInviteLinksForDepartments(
  departmentIds: string[]
): Promise<Pick<DepartmentInviteLink, 'department_id' | 'invite_code' | 'rotated_at'>[]> {
  if (departmentIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_invite_links')
    .select('department_id, invite_code, rotated_at')
    .in('department_id', departmentIds)

  if (error) throw toDbError('Failed to fetch invite links', error)
  return (
    (data as Pick<
      DepartmentInviteLink,
      'department_id' | 'invite_code' | 'rotated_at'
    >[] | null) ?? []
  )
}

export async function findDepartmentScope(
  departmentId: string,
  orgId: string
): Promise<{ id: string; org_id: string } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('departments')
    .select('id, org_id')
    .eq('id', departmentId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to load department', error)
  return (data as { id: string; org_id: string } | null) ?? null
}

/**
 * Attempt to rotate a department invite link to a new code. Returns
 * `{ ok: true }` on success, `{ ok: false, duplicate: true }` if the new
 * code collided with an existing one (caller should retry with a fresh
 * code), or throws on any other error.
 */
export async function rotateInviteCode(input: {
  departmentId: string
  orgId: string
  newCode: string
}): Promise<{ ok: true } | { ok: false; duplicate: true }> {
  const db = await getServiceDb()
  const { error } = await db
    .from('department_invite_links')
    .update({
      invite_code: input.newCode,
      rotated_at: new Date().toISOString(),
    })
    .eq('department_id', input.departmentId)
    .eq('org_id', input.orgId)

  if (!error) return { ok: true }
  if (error.message.toLowerCase().includes('duplicate')) {
    return { ok: false, duplicate: true }
  }
  throw toDbError('Failed to rotate invite link', error)
}

// -----------------------------------------------------------------------------
// Member onboarding requests
// -----------------------------------------------------------------------------

export interface PendingOnboardingRequest {
  id: string
  org_id: string
  department_id: string
  invite_link_id: string
  email: string
  first_name: string
  last_name: string
  grade: string | null
  requested_role: UserRole
  link_type: OnboardingLinkType
  requested_user_id: string | null
  status: OnboardingRequestStatus
  completed_at: string | null
}

export async function findPendingOnboardingRequest(input: {
  departmentId: string
  email: string
}): Promise<PendingOnboardingRequest | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('member_onboarding_requests')
    .select('*')
    .eq('department_id', input.departmentId)
    .eq('email', input.email)
    .eq('status', 'PENDING')
    .maybeSingle()

  if (error) throw toDbError('Failed to load onboarding request', error)
  return (data as PendingOnboardingRequest | null) ?? null
}

export async function findOnboardingRequestById(
  id: string
): Promise<PendingOnboardingRequest | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('member_onboarding_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to load onboarding request', error)
  return (data as PendingOnboardingRequest | null) ?? null
}

export async function updateOnboardingRequest(
  id: string,
  updates: {
    orgId?: string
    inviteLinkId?: string
    firstName?: string
    lastName?: string
    requestedRole?: UserRole
    linkType?: OnboardingLinkType
    requestedUserId?: string | null
  }
): Promise<PendingOnboardingRequest> {
  const db = await getServiceDb()
  const patch: Record<string, unknown> = {}
  if (updates.orgId !== undefined) patch.org_id = updates.orgId
  if (updates.inviteLinkId !== undefined) patch.invite_link_id = updates.inviteLinkId
  if (updates.firstName !== undefined) patch.first_name = updates.firstName
  if (updates.lastName !== undefined) patch.last_name = updates.lastName
  if (updates.requestedRole !== undefined) patch.requested_role = updates.requestedRole
  if (updates.linkType !== undefined) patch.link_type = updates.linkType
  if (updates.requestedUserId !== undefined)
    patch.requested_user_id = updates.requestedUserId

  const { data, error } = await db
    .from('member_onboarding_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw toDbError('Failed to update onboarding request', error)
  return data as PendingOnboardingRequest
}

export async function insertOnboardingRequest(input: {
  orgId: string
  departmentId: string
  inviteLinkId: string
  email: string
  firstName: string
  lastName: string
  grade?: string | null
  requestedRole: UserRole
  linkType: OnboardingLinkType
  requestedUserId: string | null
}): Promise<PendingOnboardingRequest> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('member_onboarding_requests')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      invite_link_id: input.inviteLinkId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      grade: input.grade ?? null,
      requested_role: input.requestedRole,
      link_type: input.linkType,
      requested_user_id: input.requestedUserId,
      status: 'PENDING' as OnboardingRequestStatus,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create onboarding request', error)
  return data as PendingOnboardingRequest
}

export async function updateOnboardingRequestLinkType(
  id: string,
  linkType: OnboardingLinkType
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('member_onboarding_requests')
    .update({ link_type: linkType })
    .eq('id', id)

  if (error) throw toDbError('Failed to update onboarding request', error)
}

export async function markOnboardingRequestComplete(
  id: string,
  requestedUserId: string
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('member_onboarding_requests')
    .update({
      requested_user_id: requestedUserId,
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw toDbError('Failed to complete onboarding request', error)
}

// -----------------------------------------------------------------------------
// Profiles
// -----------------------------------------------------------------------------

export async function findProfileByEmail(email: string): Promise<Profile | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('email', email)
    .maybeSingle()

  if (error) throw toDbError('Failed to load profile', error)
  return (data as Profile | null) ?? null
}

export async function findProfileByUserId(userId: string): Promise<Profile | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to load profile', error)
  return (data as Profile | null) ?? null
}

export async function listProfilesForUsers(
  userIds: string[]
): Promise<Pick<Profile, 'user_id' | 'email' | 'full_name' | 'first_name' | 'last_name'>[]> {
  if (userIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('profiles')
    .select('user_id, email, full_name, first_name, last_name')
    .in('user_id', userIds)

  if (error) throw toDbError('Failed to fetch profiles', error)
  return (
    (data as Pick<
      Profile,
      'user_id' | 'email' | 'full_name' | 'first_name' | 'last_name'
    >[] | null) ?? []
  )
}

export async function upsertProfile(input: {
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  fullName: string | null
  emailVerifiedAt: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('profiles').upsert(
    {
      user_id: input.userId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      full_name: input.fullName,
      email_verified_at: input.emailVerifiedAt,
    },
    { onConflict: 'user_id' }
  )

  if (error) throw toDbError('Failed to update profile', error)
}

// -----------------------------------------------------------------------------
// Membership helpers
// -----------------------------------------------------------------------------

export async function listUserOrganizationMemberships(
  userId: string
): Promise<{ org_id: string; role: string; organization_name: string | null }[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organization_members')
    .select('org_id, role, organizations:org_id(name)')
    .eq('user_id', userId)

  if (error) throw toDbError('Failed to load organization memberships', error)

  type Row = {
    org_id: string
    role: string
    organizations: { name: string } | { name: string }[] | null
  }

  return ((data as Row[] | null) ?? []).map((row) => {
    const org = row.organizations
    const name = !org
      ? null
      : Array.isArray(org)
        ? org[0]?.name ?? null
        : org.name ?? null
    return {
      org_id: row.org_id,
      role: row.role,
      organization_name: name,
    }
  })
}

export async function deleteDepartmentMembershipsInOrgs(
  userId: string,
  orgIds: string[]
): Promise<void> {
  if (orgIds.length === 0) return
  const db = await getServiceDb()
  const { error } = await db
    .from('department_members')
    .delete()
    .eq('user_id', userId)
    .in('org_id', orgIds)

  if (error) throw toDbError('Failed to remove department memberships', error)
}

export async function deleteOrganizationMembershipsInOrgs(
  userId: string,
  orgIds: string[]
): Promise<void> {
  if (orgIds.length === 0) return
  const db = await getServiceDb()
  const { error } = await db
    .from('organization_members')
    .delete()
    .eq('user_id', userId)
    .in('org_id', orgIds)

  if (error) throw toDbError('Failed to remove organization memberships', error)
}

export async function deleteMembershipsInOtherOrgs(
  userId: string,
  keepOrgId: string
): Promise<void> {
  const db = await getServiceDb()
  const [deptRes, orgRes] = await Promise.all([
    db.from('department_members').delete().eq('user_id', userId).neq('org_id', keepOrgId),
    db
      .from('organization_members')
      .delete()
      .eq('user_id', userId)
      .neq('org_id', keepOrgId),
  ])
  if (deptRes.error)
    throw toDbError('Failed to remove previous department memberships', deptRes.error)
  if (orgRes.error)
    throw toDbError('Failed to remove previous organization memberships', orgRes.error)
}

export async function findDepartmentMembershipRole(
  departmentId: string,
  userId: string
): Promise<UserRole | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_members')
    .select('role')
    .eq('department_id', departmentId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to load existing department membership', error)
  return (data as { role: UserRole } | null)?.role ?? null
}

export async function upsertOrganizationMember(input: {
  orgId: string
  userId: string
  role: UserRole
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('organization_members').upsert(
    {
      org_id: input.orgId,
      user_id: input.userId,
      role: input.role,
    },
    { onConflict: 'org_id,user_id' }
  )

  if (error) throw toDbError('Failed to upsert organization membership', error)
}

export async function upsertDepartmentMember(input: {
  orgId: string
  departmentId: string
  userId: string
  role: UserRole
  grade?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const row: Record<string, unknown> = {
    org_id: input.orgId,
    department_id: input.departmentId,
    user_id: input.userId,
    role: input.role,
  }
  if (input.grade !== undefined) row.grade = input.grade
  const { error } = await db
    .from('department_members')
    .upsert(row, { onConflict: 'department_id,user_id' })

  if (error) throw toDbError('Failed to upsert department membership', error)
}

// -----------------------------------------------------------------------------
// Department code lookup
// -----------------------------------------------------------------------------

export interface DepartmentCodeLookup {
  department_id: string
  department_name: string
  department_code: string
  org_id: string
  org_name: string
  invite_link_id: string
}

export async function findDepartmentByCode(
  code: string
): Promise<DepartmentCodeLookup | null> {
  const db = await getServiceDb()
  const normalizedCode = code.trim().replace(/\D/g, '')

  const { data, error } = await db
    .from('departments')
    .select('id, name, department_code, org_id, organizations:org_id(id, name)')
    .eq('department_code', normalizedCode)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up department code', error)
  if (!data) return null

  const org = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations

  // Also look up the invite link for this department (needed for onboarding requests)
  const { data: inviteLink } = await db
    .from('department_invite_links')
    .select('id')
    .eq('department_id', data.id)
    .maybeSingle()

  return {
    department_id: data.id,
    department_name: data.name,
    department_code: data.department_code,
    org_id: data.org_id,
    org_name: org?.name ?? '',
    invite_link_id: inviteLink?.id ?? '',
  }
}

// -----------------------------------------------------------------------------
// Org members management (settings panel)
// -----------------------------------------------------------------------------

export interface OrgMemberRow {
  user_id: string
  role: UserRole
  created_at: string
}

export async function listOrganizationMembers(orgId: string): Promise<OrgMemberRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })

  if (error) throw toDbError('Failed to fetch organization members', error)
  return (data as OrgMemberRow[] | null) ?? []
}

export interface DepartmentMemberWithName {
  user_id: string
  role: UserRole
  department_name: string | null
}

export async function listDepartmentMembersWithNames(
  orgId: string
): Promise<DepartmentMemberWithName[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_members')
    .select('user_id, role, departments:department_id(name)')
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to fetch department members', error)

  type Row = {
    user_id: string
    role: UserRole
    departments: { name: string } | { name: string }[] | null
  }

  return ((data as Row[] | null) ?? []).map((row) => {
    const dept = row.departments
    const name = !dept
      ? null
      : Array.isArray(dept)
        ? dept[0]?.name ?? null
        : dept.name ?? null
    return {
      user_id: row.user_id,
      role: row.role,
      department_name: name,
    }
  })
}

export async function findOrganizationMembershipRole(input: {
  orgId: string
  userId: string
}): Promise<UserRole | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('organization_members')
    .select('role')
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to load organization membership', error)
  return (data as { role: UserRole } | null)?.role ?? null
}

export async function hasDepartmentAdminRole(input: {
  orgId: string
  userId: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('department_members')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)
    .eq('role', 'department_admin')
    .maybeSingle()

  if (error) throw toDbError('Failed to load department roles', error)
  return !!data
}

export async function deleteDepartmentMembershipsForOrgUser(input: {
  orgId: string
  userId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('department_members')
    .delete()
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)

  if (error) throw toDbError('Failed to remove department memberships', error)
}

export async function deleteOrganizationMembership(input: {
  orgId: string
  userId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('organization_members')
    .delete()
    .eq('org_id', input.orgId)
    .eq('user_id', input.userId)

  if (error) throw toDbError('Failed to remove organization membership', error)
}
