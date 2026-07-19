'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import {
  clientIpFromHeaders,
  evaluateLoginLinkRateLimit,
  LOGIN_LINK_WINDOW_MINUTES,
} from '@/lib/rate-limit'
import * as loginLinksDb from '@/lib/db/login-links'
import {
  getCurrentOrgId,
  getCurrentUser,
  getCurrentUserId,
  isOrgAdmin,
  isSuperAdmin,
  requireOrg,
  requireOrgManager,
} from '@/lib/auth'
import {
  getDepartmentsForOrg,
  getMyModeratedDepartments,
} from '@/app/actions/departments'
import { getAppUrl, getAppUrlFromHeaders } from '@/lib/app-url'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { safeNextPath } from '@/lib/safe-next-path'
import {
  buildDepartmentInviteActivationEmailHtml,
  buildDepartmentJoinMagicLinkEmailHtml,
  buildPasswordlessLoginEmailHtml,
} from '@/lib/email-templates'
import type {
  ManagedDepartmentInviteLink,
  ManagedOrgMember,
  OnboardingLinkType,
  Profile,
  UserRole,
} from '@/lib/types'
import * as onboardingDb from '@/lib/db/onboarding'
import type {
  InviteLookupRecord,
  PendingOnboardingRequest,
} from '@/lib/db/onboarding'
import { DbNotFoundError } from '@/lib/db'

const DEFAULT_MEMBER_ROLE: UserRole = 'trainee'

/**
 * Build a link pointing directly at our /join/callback page with the
 * hashed token.  The callback page calls supabase.auth.verifyOtp()
 * client-side, which bypasses Supabase's redirect_to handling entirely.
 */
function buildCallbackLink(
  baseUrl: string,
  hashedToken: string,
  type: string,
  extra?: Record<string, string>
): string {
  const url = new URL(`${baseUrl}/join/callback`)
  url.searchParams.set('token_hash', hashedToken)
  url.searchParams.set('type', type)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      url.searchParams.set(k, v)
    }
  }
  return url.toString()
}

interface BeginDepartmentOnboardingInput {
  inviteCode?: string
  departmentCode?: string
  email: string
  firstName: string
  lastName: string
  grade?: string
  confirmOrgSwitch?: boolean
}

type BeginDepartmentOnboardingResult =
  | {
      status: 'confirm-switch'
      currentOrgName: string
      targetOrgName: string
    }
  | {
      status: 'email-sent'
      message: string
    }
  | {
      status: 'joined'
      redirectTo: string
    }

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizeName(name: string) {
  return name.trim()
}

function buildFullName(firstName: string, lastName: string) {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
}

function generateInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 12; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return code
}

async function getManagedDepartmentsForCurrentUser(orgId: string) {
  const [superAdmin, orgAdmin] = await Promise.all([isSuperAdmin(), isOrgAdmin(orgId)])

  if (superAdmin || orgAdmin) {
    return getDepartmentsForOrg(orgId)
  }

  return getMyModeratedDepartments(orgId)
}

async function ensureInviteLinksForDepartments(
  orgId: string,
  departments: { id: string; name: string; department_code: string }[]
): Promise<ManagedDepartmentInviteLink[]> {
  if (departments.length === 0) return []

  const currentUserId = await getCurrentUserId()
  const departmentIds = departments.map((d) => d.id)

  const existingDepartmentIds = new Set(
    await onboardingDb.listInviteLinkDepartmentIds(departmentIds)
  )
  const missingDepartments = departments.filter((d) => !existingDepartmentIds.has(d.id))

  if (missingDepartments.length > 0) {
    await onboardingDb.insertInviteLinksForDepartments(
      missingDepartments.map((d) => ({
        orgId,
        departmentId: d.id,
        createdBy: currentUserId,
      }))
    )
  }

  const inviteLinks = await onboardingDb.listInviteLinksForDepartments(departmentIds)
  const appUrl = getAppUrl()

  return departments
    .map((department) => {
      const inviteLink = inviteLinks.find((row) => row.department_id === department.id)
      if (!inviteLink) return null
      return {
        department_id: department.id,
        department_name: department.name,
        department_code: department.department_code,
        invite_code: inviteLink.invite_code,
        invite_url: `${appUrl}/join/${inviteLink.invite_code}`,
        rotated_at: inviteLink.rotated_at,
      }
    })
    .filter(Boolean) as ManagedDepartmentInviteLink[]
}

async function upsertPendingOnboardingRequest(
  invite: { id: string; org_id: string; department_id: string },
  input: {
    email: string
    firstName: string
    lastName: string
    grade?: string | null
    requestedUserId: string | null
    linkType: OnboardingLinkType
  }
): Promise<PendingOnboardingRequest> {
  const existing = await onboardingDb.findPendingOnboardingRequest({
    departmentId: invite.department_id,
    email: input.email,
  })

  if (existing) {
    return onboardingDb.updateOnboardingRequest(existing.id, {
      orgId: invite.org_id,
      inviteLinkId: invite.id,
      firstName: input.firstName,
      lastName: input.lastName,
      requestedRole: DEFAULT_MEMBER_ROLE,
      linkType: input.linkType,
      requestedUserId: input.requestedUserId,
    })
  }

  return onboardingDb.insertOnboardingRequest({
    orgId: invite.org_id,
    departmentId: invite.department_id,
    inviteLinkId: invite.id,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    grade: input.grade,
    requestedRole: DEFAULT_MEMBER_ROLE,
    linkType: input.linkType,
    requestedUserId: input.requestedUserId,
  })
}

async function upsertProfileForUser(params: {
  userId: string
  email: string
  firstName: string
  lastName: string
  emailVerifiedAt: string | null
}) {
  const fullName = buildFullName(params.firstName, params.lastName)
  await onboardingDb.upsertProfile({
    userId: params.userId,
    email: params.email,
    firstName: params.firstName || null,
    lastName: params.lastName || null,
    fullName: fullName || null,
    emailVerifiedAt: params.emailVerifiedAt,
  })
}

async function finalizeOnboardingRequest(
  request: PendingOnboardingRequest,
  currentUser: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
) {
  const normalizedCurrentEmail = normalizeEmail(currentUser.email || '')

  if (!normalizedCurrentEmail || normalizedCurrentEmail !== request.email) {
    throw new Error('Signed-in email does not match this invite')
  }

  const memberships = await onboardingDb.listUserOrganizationMemberships(currentUser.id)

  const targetOrgMembership = memberships.find((m) => m.org_id === request.org_id)
  const otherOrgIds = Array.from(
    new Set(
      memberships.filter((m) => m.org_id !== request.org_id).map((m) => m.org_id)
    )
  )

  if (otherOrgIds.length > 0) {
    await onboardingDb.deleteDepartmentMembershipsInOrgs(currentUser.id, otherOrgIds)
    await onboardingDb.deleteOrganizationMembershipsInOrgs(currentUser.id, otherOrgIds)
  }

  const existingDepartmentRole = await onboardingDb.findDepartmentMembershipRole(
    request.department_id,
    currentUser.id
  )

  const resolvedOrgRole =
    (targetOrgMembership?.role as UserRole | undefined) || request.requested_role
  const resolvedDepartmentRole = existingDepartmentRole || request.requested_role

  await onboardingDb.upsertOrganizationMember({
    orgId: request.org_id,
    userId: currentUser.id,
    role: resolvedOrgRole,
  })

  await onboardingDb.upsertDepartmentMember({
    orgId: request.org_id,
    departmentId: request.department_id,
    userId: currentUser.id,
    role: resolvedDepartmentRole,
    grade: request.grade,
  })

  const firstName = normalizeName(request.first_name)
  const lastName = normalizeName(request.last_name)
  const fullName = buildFullName(firstName, lastName)

  // Auth-plane: sync user metadata via GoTrue admin API.
  const serviceClient = await createSupabaseServiceClient()
  const { error: updateUserError } = await serviceClient.auth.admin.updateUserById(
    currentUser.id,
    {
      user_metadata: {
        ...(currentUser.user_metadata || {}),
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
      },
    }
  )

  if (updateUserError) {
    throw new Error(`Failed to sync user metadata: ${updateUserError.message}`)
  }

  await upsertProfileForUser({
    userId: currentUser.id,
    email: normalizedCurrentEmail,
    firstName,
    lastName,
    emailVerifiedAt: currentUser.email_confirmed_at || new Date().toISOString(),
  })

  await onboardingDb.markOnboardingRequestComplete(request.id, currentUser.id)

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/settings')
}

export async function getManagedDepartmentInviteLinks() {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  const departments = await getManagedDepartmentsForCurrentUser(orgId)
  return ensureInviteLinksForDepartments(orgId, departments)
}

export async function rotateDepartmentInviteLink(departmentId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  const department = await onboardingDb.findDepartmentScope(departmentId, orgId)
  if (!department) {
    throw new DbNotFoundError('Department not found')
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextCode = generateInviteCode()
    const result = await onboardingDb.rotateInviteCode({
      departmentId,
      orgId,
      newCode: nextCode,
    })

    if (result.ok) {
      revalidatePath('/admin')
      return { success: true }
    }
    // If it was a duplicate, loop and try a fresh code.
  }

  throw new Error('Failed to generate a unique invite code')
}

export async function getOrgMembersForManagement(): Promise<ManagedOrgMember[]> {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  const [organizationMembers, departmentMembers] = await Promise.all([
    onboardingDb.listOrganizationMembers(orgId),
    onboardingDb.listDepartmentMembersWithNames(orgId),
  ])

  const userIds = organizationMembers.map((m) => m.user_id)
  if (userIds.length === 0) return []

  const profiles = await onboardingDb.listProfilesForUsers(userIds)
  const profileMap = new Map<
    string,
    Pick<Profile, 'email' | 'full_name' | 'first_name' | 'last_name'>
  >(
    profiles.map((profile) => [
      profile.user_id,
      {
        email: profile.email,
        full_name: profile.full_name,
        first_name: profile.first_name,
        last_name: profile.last_name,
      },
    ])
  )

  const membersByUserId = new Map<
    string,
    {
      role: UserRole
      joinedAt: string
      departments: string[]
      hasDepartmentAdminRole: boolean
    }
  >()

  for (const member of organizationMembers) {
    membersByUserId.set(member.user_id, {
      role: member.role,
      joinedAt: member.created_at,
      departments: [],
      hasDepartmentAdminRole: false,
    })
  }

  for (const departmentMember of departmentMembers) {
    const entry = membersByUserId.get(departmentMember.user_id)
    if (!entry) continue

    if (
      departmentMember.department_name &&
      !entry.departments.includes(departmentMember.department_name)
    ) {
      entry.departments.push(departmentMember.department_name)
    }

    if (departmentMember.role === 'department_admin') {
      entry.hasDepartmentAdminRole = true
    }
  }

  // Auth-plane: back-fill profile info from GoTrue for users without a
  // profile row. Stays on a direct Supabase client until auth swap.
  const missingProfileUserIds = userIds.filter((userId) => !profileMap.has(userId))
  if (missingProfileUserIds.length > 0) {
    const serviceClient = await createSupabaseServiceClient()
    const fallbackUsers = await Promise.all(
      missingProfileUserIds.map(async (userId) => {
        const { data, error } = await serviceClient.auth.admin.getUserById(userId)
        if (error || !data.user.email) return null
        return {
          userId,
          email: data.user.email,
          fullName:
            typeof data.user.user_metadata?.full_name === 'string'
              ? data.user.user_metadata.full_name
              : null,
          firstName:
            typeof data.user.user_metadata?.first_name === 'string'
              ? data.user.user_metadata.first_name
              : null,
          lastName:
            typeof data.user.user_metadata?.last_name === 'string'
              ? data.user.user_metadata.last_name
              : null,
        }
      })
    )
    for (const fallbackUser of fallbackUsers) {
      if (!fallbackUser) continue
      profileMap.set(fallbackUser.userId, {
        email: fallbackUser.email,
        full_name: fallbackUser.fullName,
        first_name: fallbackUser.firstName,
        last_name: fallbackUser.lastName,
      })
    }
  }

  return userIds
    .map((userId) => {
      const member = membersByUserId.get(userId)
      const profile = profileMap.get(userId)
      if (!member || !profile?.email) return null
      return {
        user_id: userId,
        email: profile.email,
        full_name: profile.full_name,
        first_name: profile.first_name,
        last_name: profile.last_name,
        role: member.role,
        joined_at: member.joinedAt,
        department_names: [...member.departments].sort((a, b) => a.localeCompare(b)),
        removable: member.role !== 'org_admin' && !member.hasDepartmentAdminRole,
      }
    })
    .filter(Boolean) as ManagedOrgMember[]
}

export async function removeOrgMember(memberUserId: string) {
  const currentUserId = await getCurrentUserId()
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  if (currentUserId && currentUserId === memberUserId) {
    throw new Error('You cannot remove your own membership from here')
  }

  const [organizationRole, isDepartmentAdmin] = await Promise.all([
    onboardingDb.findOrganizationMembershipRole({ orgId, userId: memberUserId }),
    onboardingDb.hasDepartmentAdminRole({ orgId, userId: memberUserId }),
  ])

  if (!organizationRole) {
    throw new DbNotFoundError('Member not found in this organization')
  }

  if (organizationRole === 'org_admin' || isDepartmentAdmin) {
    throw new Error('Removing organization admins or moderators is out of scope for this flow')
  }

  await onboardingDb.deleteDepartmentMembershipsForOrgUser({ orgId, userId: memberUserId })
  await onboardingDb.deleteOrganizationMembership({ orgId, userId: memberUserId })

  revalidatePath('/admin')
  revalidatePath('/dashboard')
  revalidatePath('/departments')

  return { success: true }
}

export async function lookupDepartmentByCode(code: string) {
  return onboardingDb.findDepartmentByCode(code)
}

export async function beginDepartmentOnboarding(
  input: BeginDepartmentOnboardingInput
): Promise<BeginDepartmentOnboardingResult> {
  // Resolve the department — either by invite code or 6-digit department code
  let orgId: string
  let departmentId: string
  let inviteLinkId: string
  let orgName: string
  let departmentName: string

  if (input.departmentCode) {
    const dept = await onboardingDb.findDepartmentByCode(input.departmentCode)
    if (!dept) throw new DbNotFoundError('Department not found')
    orgId = dept.org_id
    departmentId = dept.department_id
    inviteLinkId = dept.invite_link_id
    orgName = dept.org_name
    departmentName = dept.department_name
  } else if (input.inviteCode) {
    const invite = await onboardingDb.findInviteByCode(input.inviteCode)
    if (!invite || !invite.departments || !invite.organizations) {
      throw new DbNotFoundError('Invite link not found')
    }
    orgId = invite.org_id
    departmentId = invite.department_id
    inviteLinkId = invite.id
    orgName = invite.organizations.name
    departmentName = invite.departments.name
  } else {
    throw new Error('Either inviteCode or departmentCode is required')
  }

  const inviteRef = { id: inviteLinkId, org_id: orgId, department_id: departmentId }

  const email = normalizeEmail(input.email)
  const firstName = normalizeName(input.firstName)
  const lastName = normalizeName(input.lastName)

  if (!email || !firstName || !lastName) {
    throw new Error('Email, first name, and last name are required')
  }

  const currentUser = await getCurrentUser()
  const profile = await onboardingDb.findProfileByEmail(email)

  const currentUserMatchesEmail =
    !!currentUser?.email && normalizeEmail(currentUser.email) === email
  const resolvedUserId =
    (currentUserMatchesEmail ? currentUser?.id : null) || profile?.user_id || null
  const isVerifiedAccount =
    !!profile?.email_verified_at ||
    !!(currentUserMatchesEmail && currentUser?.email_confirmed_at)

  let currentOrgName: string | null = null

  if (resolvedUserId) {
    const memberships = await onboardingDb.listUserOrganizationMemberships(resolvedUserId)
    const conflicting = memberships.find((m) => m.org_id !== orgId)
    if (conflicting) {
      currentOrgName = conflicting.organization_name
    }
  }

  if (currentOrgName && !input.confirmOrgSwitch) {
    return {
      status: 'confirm-switch',
      currentOrgName,
      targetOrgName: orgName,
    }
  }

  const linkType: OnboardingLinkType = isVerifiedAccount ? 'magiclink' : 'invite'
  const request = await upsertPendingOnboardingRequest(inviteRef, {
    email,
    firstName,
    lastName,
    grade: input.grade,
    requestedUserId: resolvedUserId,
    linkType,
  })

  if (currentUserMatchesEmail && currentUser?.email_confirmed_at) {
    await finalizeOnboardingRequest(request, currentUser)
    return { status: 'joined', redirectTo: '/dashboard' }
  }

  // Auth-plane: generate onboarding link via GoTrue and send email.
  const serviceClient = await createSupabaseServiceClient()
  const baseUrl = await getAppUrlFromHeaders()
  const fullName = buildFullName(firstName, lastName)

  let generatedLinkType: OnboardingLinkType = linkType
  let actionLink: string | null = null

  const generateLink = async (type: OnboardingLinkType) => {
    const { data, error } = await serviceClient.auth.admin.generateLink({
      type,
      email,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
        },
      },
    })
    if (error) return { hashedToken: null, error }
    return { hashedToken: data.properties.hashed_token, error: null }
  }

  let generatedLink = await generateLink(linkType)

  if (
    generatedLink.error &&
    linkType === 'invite' &&
    generatedLink.error.message.toLowerCase().includes('already')
  ) {
    generatedLinkType = 'magiclink'
    await onboardingDb.updateOnboardingRequestLinkType(request.id, 'magiclink')
    generatedLink = await generateLink('magiclink')
  }

  if (generatedLink.error || !generatedLink.hashedToken) {
    throw new Error(
      `Failed to generate onboarding link: ${generatedLink.error?.message || 'Unknown error'}`
    )
  }

  actionLink = buildCallbackLink(baseUrl, generatedLink.hashedToken, generatedLinkType, {
    requestId: request.id,
  })

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const html =
    generatedLinkType === 'invite'
      ? buildDepartmentInviteActivationEmailHtml({
          departmentName,
          organizationName: orgName,
          inviteUrl: actionLink,
          firstName,
        })
      : buildDepartmentJoinMagicLinkEmailHtml({
          departmentName,
          organizationName: orgName,
          inviteUrl: actionLink,
          firstName,
        })

  const { error: emailError } = await mailer.emails.send({
    from: fromAddress,
    to: email,
    subject:
      generatedLinkType === 'invite'
        ? `Activate your access to ${departmentName}`
        : `Join ${departmentName}`,
    html,
  })

  if (emailError) {
    throw new Error(`Failed to send onboarding email: ${emailError.message}`)
  }

  return {
    status: 'email-sent',
    message:
      generatedLinkType === 'invite'
        ? `Check ${email} for your activation email.`
        : `Check ${email} for your sign-in link.`,
  }
}

export async function finalizeMemberOnboarding(requestId: string) {
  const currentUser = await getCurrentUser()

  if (!currentUser) {
    throw new Error('You must be signed in to complete onboarding')
  }

  const request = await onboardingDb.findOnboardingRequestById(requestId)
  if (!request) {
    throw new DbNotFoundError('Onboarding request not found')
  }

  if (request.status === 'COMPLETED') {
    return { success: true, redirectTo: '/dashboard' }
  }

  if (request.status !== 'PENDING') {
    throw new Error('This onboarding request is no longer active')
  }

  await finalizeOnboardingRequest(request, currentUser)

  return { success: true, redirectTo: '/dashboard' }
}

export async function sendPasswordlessLoginLink(
  emailInput: string,
  nextPath = '/dashboard'
): Promise<{ success: boolean; message: string }> {
  const email = normalizeEmail(emailInput)
  const safeNext = safeNextPath(nextPath)
  if (!email) {
    return { success: false, message: 'Email is required' }
  }

  // Rate limit: this form is public and our send path bypasses GoTrue's
  // built-in email throttles, so enforce our own per-email and per-IP
  // windows (policy in lib/rate-limit.ts, log in login_link_requests).
  // Fail open: a limiter outage (e.g. migration 041 not applied yet) must
  // degrade to unthrottled sign-in, not block sign-in entirely.
  try {
    const ip = clientIpFromHeaders(await headers())
    const sinceIso = new Date(
      Date.now() - LOGIN_LINK_WINDOW_MINUTES * 60 * 1000
    ).toISOString()
    const counts = await loginLinksDb.countRecentLoginLinkRequests({ email, ip, sinceIso })
    const decision = evaluateLoginLinkRateLimit(counts)
    if (!decision.allowed) {
      return { success: false, message: decision.message ?? 'Too many requests.' }
    }
    await loginLinksDb.recordLoginLinkRequest({ email, ip })
  } catch (rateLimitError) {
    console.error(
      `[auth] Sign-in rate limiter unavailable, proceeding without it: ${
        rateLimitError instanceof Error ? rateLimitError.message : rateLimitError
      }`
    )
  }

  // Auth-plane: generate magic link via GoTrue.
  // If user doesn't exist, generateLink with type 'magiclink' will create them.
  const serviceClient = await createSupabaseServiceClient()
  const baseUrl = await getAppUrlFromHeaders()

  // Try magiclink first (for existing users)
  let linkResult = await serviceClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  // If user doesn't exist, create via invite link
  if (linkResult.error && linkResult.error.message.toLowerCase().includes('not found')) {
    linkResult = await serviceClient.auth.admin.generateLink({
      type: 'invite',
      email,
    })
  }

  const { data, error } = linkResult

  if (error) {
    // Thrown server-action errors are masked in production ("An error
    // occurred in the Server Components render…"), so log the real cause
    // and return a readable message instead.
    console.error(`[auth] Failed to generate sign-in link for ${email}: ${error.message}`)
    return {
      success: false,
      message: 'We could not create a sign-in link right now. Please try again shortly.',
    }
  }

  const linkType = data.properties.verification_type === 'invite' ? 'invite' : 'magiclink'
  const inviteUrl = buildCallbackLink(baseUrl, data.properties.hashed_token, linkType, {
    mode: 'login',
    next: safeNext,
  })

  const profile = await onboardingDb.findProfileByEmail(email)
  const firstName =
    (profile?.first_name && profile.first_name.trim()) ||
    (profile?.full_name && profile.full_name.trim().split(' ')[0]) ||
    null

  // Resend's sandbox sender (onboarding@resend.dev) only delivers to the account
  // owner's address until a custom sending domain is verified, which blocks local
  // testing. Development ONLY: printing a live sign-in link to logs is an
  // account takeover for anyone with log access, so there is deliberately no
  // production escape hatch (the old AUTH_DEV_LINKS override is gone).
  const devLinksEnabled = process.env.NODE_ENV !== 'production'
  if (devLinksEnabled) {
    console.log(`\n🔗 [auth] Sign-in link for ${email}:\n${inviteUrl}\n`)
  }

  // getFromAddress() throws when MAIL_FROM is unset in production — catch
  // config errors here so the visitor sees a real message, not a masked
  // digest, and the cause lands in the server logs.
  let emailErrorMessage: string | null = null
  try {
    const mailer = getEmailClient()
    const fromAddress = getFromAddress()

    const { error: emailError } = await mailer.emails.send({
      from: fromAddress,
      to: email,
      subject: 'Your Petrios sign-in link',
      html: buildPasswordlessLoginEmailHtml({
        inviteUrl,
        firstName,
      }),
    })
    emailErrorMessage = emailError?.message ?? null
  } catch (configError) {
    emailErrorMessage =
      configError instanceof Error ? configError.message : 'email transport misconfigured'
  }

  if (emailErrorMessage) {
    if (devLinksEnabled) {
      return {
        success: true,
        message: `Email delivery failed (${emailErrorMessage}). Dev mode: open the sign-in link printed in the server console.`,
      }
    }
    console.error(`[auth] Failed to send sign-in email to ${email}: ${emailErrorMessage}`)
    return {
      success: false,
      message:
        'We could not send the sign-in email. Please try again shortly, or contact your organiser if this keeps happening.',
    }
  }

  return {
    success: true,
    message: devLinksEnabled
      ? 'Sign-in link sent — also printed in the server console for local testing.'
      : 'Check your email for a sign-in link.',
  }
}

export async function getJoinInviteLandingData(inviteCode: string) {
  const invite = await onboardingDb.findInviteByCode(inviteCode)

  if (!invite || !invite.departments || !invite.organizations) {
    return null
  }

  const currentUser = await getCurrentUser()
  const currentUserMatchesOrg = currentUser ? await getCurrentOrgId() : null

  const profile = currentUser?.id
    ? await onboardingDb.findProfileByUserId(currentUser.id)
    : null

  return {
    inviteCode: invite.invite_code,
    organizationName: invite.organizations.name,
    departmentName: invite.departments.name,
    isSignedIn: !!currentUser,
    currentOrgId: currentUserMatchesOrg,
    initialEmail: currentUser?.email || profile?.email || '',
    initialFirstName:
      profile?.first_name ||
      (typeof currentUser?.user_metadata?.first_name === 'string'
        ? currentUser.user_metadata.first_name
        : '') ||
      '',
    initialLastName:
      profile?.last_name ||
      (typeof currentUser?.user_metadata?.last_name === 'string'
        ? currentUser.user_metadata.last_name
        : '') ||
      '',
  }
}
