'use server'

import { revalidatePath } from 'next/cache'
import {
  requireAuth,
  getCurrentUser,
  requireSuperAdmin,
  requireDepartmentModerator,
} from '@/lib/auth'
import {
  isJoinRequestableRole,
  joinRequestBindingError,
  joinRequestEffectiveRole,
  joinRequestGrantRole,
  type JoinRequestableRole,
} from '@/lib/join-request-policy'
import * as joinRequestsDb from '@/lib/db/join-requests'
import * as departmentsDb from '@/lib/db/departments'
import * as onboardingDb from '@/lib/db/onboarding'
import { DbNotFoundError } from '@/lib/db'

/**
 * Legacy department join requests. Every organisation/department binding is
 * checked against the department row on the server, an approval grants only
 * the stored ordinary role (trainee or faculty), and only a moderator of the
 * request's department — working in that department's organisation — or a
 * super admin may decide a request.
 */

export async function createDepartmentJoinRequest(
  orgId: string,
  departmentId: string,
  requestedRole: JoinRequestableRole = 'trainee'
) {
  const userId = await requireAuth()
  const user = await getCurrentUser()

  if (!isJoinRequestableRole(requestedRole)) {
    throw new Error('Join requests can only ask for a trainee or faculty membership')
  }
  const departmentOrgId = await departmentsDb.findDepartmentOrgId(departmentId)
  if (joinRequestBindingError({ requestOrgId: orgId, departmentOrgId })) {
    throw new DbNotFoundError('Department not found in this organization')
  }

  const request = await joinRequestsDb.insertDepartmentJoinRequest({
    orgId,
    departmentId,
    userId,
    userEmail: user?.email || '',
    requestedRole,
  })

  revalidatePath('/admin')
  return request
}

export async function getPendingDepartmentJoinRequests() {
  await requireAuth()
  return joinRequestsDb.listPendingJoinRequests()
}

/** Every tenant's pending requests (service role): super admins only. */
export async function getAllPendingDepartmentJoinRequests() {
  await requireSuperAdmin()
  return joinRequestsDb.listPendingJoinRequests({ service: true })
}

/**
 * Loads a pending request and authorizes the caller to decide it: the
 * request's department must belong to the request's organisation, and the
 * caller must moderate that department from that organisation (or be a
 * super admin).
 */
async function requirePendingRequestDecision(requestId: string, verb: 'approve' | 'reject') {
  const request = await joinRequestsDb.findJoinRequest(requestId)
  if (!request) {
    throw new DbNotFoundError('Join request not found')
  }

  if (request.status !== 'PENDING') {
    throw new Error('Join request already processed')
  }

  const denied = new Error(`Not authorized to ${verb} this request`)
  const departmentOrgId = await departmentsDb.findDepartmentOrgId(request.department_id)
  if (joinRequestBindingError({ requestOrgId: request.org_id, departmentOrgId })) {
    throw denied
  }

  let moderatorOrgId: string
  try {
    moderatorOrgId = (await requireDepartmentModerator(request.department_id)).orgId
  } catch {
    throw denied
  }
  if (moderatorOrgId !== request.org_id) {
    throw denied
  }

  return request
}

export async function approveDepartmentJoinRequest(requestId: string) {
  const userId = await requireAuth()
  const request = await requirePendingRequestDecision(requestId, 'approve')

  // The role comes from the stored request, capped to an ordinary membership;
  // the approving client never chooses it.
  const role = joinRequestGrantRole(request.requested_role)

  const claimed = await joinRequestsDb.updateJoinRequestStatus({
    id: requestId,
    status: 'APPROVED',
    decidedBy: userId,
  })
  if (!claimed) {
    throw new Error('Join request already processed')
  }

  // Clean up prior cross-org memberships so approving a request moves the
  // user into the target org rather than leaving them straddling two.
  await onboardingDb.deleteMembershipsInOtherOrgs(request.user_id, request.org_id)

  // Never demote: a requester who already holds a higher role in this
  // department or organisation keeps it. The department role is read scoped
  // to the request's organisation, so a row planted with another org_id
  // (pre-062) is overwritten with the ordinary role, never revalidated.
  const [existingDepartmentRole, existingOrgRole] = await Promise.all([
    departmentsDb.findDepartmentMemberRole({
      departmentId: request.department_id,
      orgId: request.org_id,
      userId: request.user_id,
    }),
    onboardingDb.findOrganizationMembershipRole({
      orgId: request.org_id,
      userId: request.user_id,
    }),
  ])

  // Department membership first: with migration 062's composite key a
  // department/org mismatch fails here, before any organisation role exists.
  await onboardingDb.upsertDepartmentMember({
    orgId: request.org_id,
    departmentId: request.department_id,
    userId: request.user_id,
    role: joinRequestEffectiveRole(existingDepartmentRole, role),
  })

  await onboardingDb.upsertOrganizationMember({
    orgId: request.org_id,
    userId: request.user_id,
    role: joinRequestEffectiveRole(existingOrgRole, role),
  })

  revalidatePath('/admin')
  return { success: true }
}

export async function rejectDepartmentJoinRequest(requestId: string) {
  const userId = await requireAuth()
  await requirePendingRequestDecision(requestId, 'reject')

  const claimed = await joinRequestsDb.updateJoinRequestStatus({
    id: requestId,
    status: 'REJECTED',
    decidedBy: userId,
  })
  if (!claimed) {
    throw new Error('Join request already processed')
  }

  revalidatePath('/admin')
  return { success: true }
}

export async function getOrganizationsForJoin() {
  await requireAuth()
  return joinRequestsDb.listOrganizationsForJoin()
}

export async function getDepartmentsForOrg(orgId: string) {
  await requireAuth()
  return joinRequestsDb.listDepartmentsForJoin(orgId)
}
