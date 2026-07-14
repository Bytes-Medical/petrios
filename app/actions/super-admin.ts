'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireSuperAdmin } from '@/lib/auth'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildModeratorWelcomeEmailHtml } from '@/lib/email-templates'
import { getAppUrl } from '@/lib/app-url'
import * as superAdminsDb from '@/lib/db/super-admins'
import * as onboardingDb from '@/lib/db/onboarding'
import { DbNotFoundError } from '@/lib/db'

export async function createOrganizationAsSuperAdmin(name: string) {
  const userId = await requireAuth()
  await requireSuperAdmin()

  const org = await superAdminsDb.insertOrganizationAsUser({
    name,
    createdBy: userId,
  })

  revalidatePath('/super-admin')
  return org
}

export async function createDepartmentForOrg(orgId: string, name: string) {
  const userId = await requireAuth()
  await requireSuperAdmin()

  const department = await superAdminsDb.insertDepartmentForOrg({
    orgId,
    name,
    createdBy: userId,
  })

  revalidatePath('/super-admin')
  return department
}

export async function getAllOrganizations() {
  await requireSuperAdmin()
  return superAdminsDb.listAllOrganizations()
}

export async function getAllDepartments() {
  await requireSuperAdmin()
  return superAdminsDb.listAllDepartments()
}

export async function deleteOrganization(orgId: string) {
  await requireSuperAdmin()
  await superAdminsDb.deleteOrganizationById(orgId)
  revalidatePath('/super-admin')
  return { success: true }
}

export async function deleteDepartment(departmentId: string) {
  await requireSuperAdmin()
  await superAdminsDb.deleteDepartmentById(departmentId)
  revalidatePath('/super-admin')
  return { success: true }
}

export async function getAllUsers() {
  await requireSuperAdmin()

  // Auth-plane: listing users via GoTrue admin API. Stays on direct Supabase
  // client until auth is swapped out.
  const supabase = await createSupabaseServiceClient()
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`)
  }

  return data.users || []
}

export async function getSuperAdmins() {
  await requireSuperAdmin()
  return superAdminsDb.listSuperAdmins()
}

export async function getAllDepartmentMemberships() {
  await requireSuperAdmin()
  return superAdminsDb.listAllDepartmentMemberships()
}

export async function getAllOrganizationMemberships() {
  await requireSuperAdmin()
  return superAdminsDb.listAllOrganizationMemberships()
}

export async function grantDepartmentModerator(userId: string, departmentId: string) {
  await requireSuperAdmin()

  const department = await superAdminsDb.findDepartmentOrg(departmentId)
  if (!department) {
    throw new DbNotFoundError('Department not found')
  }

  await onboardingDb.upsertOrganizationMember({
    orgId: department.org_id,
    userId,
    role: 'department_admin',
  })

  await onboardingDb.upsertDepartmentMember({
    orgId: department.org_id,
    departmentId,
    userId,
    role: 'department_admin',
  })

  revalidatePath('/super-admin')
  return { success: true }
}

export async function revokeDepartmentModerator(userId: string, departmentId: string) {
  await requireSuperAdmin()
  await superAdminsDb.deleteDepartmentModeratorRole({ departmentId, userId })
  revalidatePath('/super-admin')
  return { success: true }
}

export async function grantSuperAdmin(userId: string) {
  await requireSuperAdmin()
  await superAdminsDb.upsertSuperAdmin(userId)
  revalidatePath('/super-admin')
  return { success: true }
}

export async function revokeSuperAdmin(userId: string) {
  await requireSuperAdmin()
  await superAdminsDb.deleteSuperAdmin(userId)
  revalidatePath('/super-admin')
  return { success: true }
}

export async function deleteUser(userId: string) {
  const currentUserId = await requireAuth()
  await requireSuperAdmin()

  if (userId === currentUserId) {
    throw new Error('You cannot delete your own account')
  }

  const supabase = await createSupabaseServiceClient()

  // Remove from all tables (cascade will handle most, but auth needs explicit delete)
  await superAdminsDb.deleteUserDataRows(userId)
  await superAdminsDb.deleteSuperAdmin(userId).catch(() => {})

  // Delete from Supabase Auth
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) throw new Error(`Failed to delete user: ${error.message}`)

  revalidatePath('/super-admin')
  return { success: true }
}

export async function createModeratorAccount(input: {
  email: string
  departmentId: string
}) {
  await requireSuperAdmin()

  const email = input.email.trim().toLowerCase()
  if (!email) throw new Error('Email is required')

  const supabase = await createSupabaseServiceClient()

  // Look up department to get org_id
  const dept = await superAdminsDb.findDepartmentWithOrgName(input.departmentId)
  if (!dept) throw new DbNotFoundError('Department not found')
  const orgName = dept.org_name

  // Check if user already exists
  const existingProfile = await onboardingDb.findProfileByEmail(email)

  let userId: string

  if (existingProfile) {
    // User exists — just upgrade their role
    userId = existingProfile.user_id
  } else {
    // User doesn't exist — create account via magic link invite
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })

    if (linkErr) throw new Error(`Failed to create account: ${linkErr.message}`)
    userId = linkData.user.id

    // Create profile
    await onboardingDb.upsertProfile({
      userId,
      email,
      firstName: null,
      lastName: null,
      fullName: null,
      emailVerifiedAt: null,
    })

    // Send magic link to new user using our callback
    const appUrl = getAppUrl()
    const callbackUrl = `${appUrl}/join/callback?token_hash=${linkData.properties.hashed_token}&type=magiclink&mode=login&next=/dashboard`

    const mailer = getEmailClient()
    const fromAddress = getFromAddress()

    await mailer.emails.send({
      from: fromAddress,
      to: email,
      subject: `You've been added as a moderator — ${dept.name}`,
      html: buildModeratorWelcomeEmailHtml({
        departmentName: dept.name,
        organizationName: orgName,
        email,
        loginUrl: callbackUrl,
      }),
    })
  }

  // Migration 044 enforces one moderator organization and demotes any prior
  // cross-organization moderator roles while preserving ordinary membership.
  await onboardingDb.upsertOrganizationMember({ orgId: dept.org_id, userId, role: 'department_admin' })
  await onboardingDb.upsertDepartmentMember({
    orgId: dept.org_id,
    departmentId: input.departmentId,
    userId,
    role: 'department_admin',
  })

  // If existing user, send notification email
  if (existingProfile) {
    const appUrl = getAppUrl()
    const mailer = getEmailClient()
    const fromAddress = getFromAddress()

    await mailer.emails.send({
      from: fromAddress,
      to: email,
      subject: `You've been added as a moderator — ${dept.name}`,
      html: buildModeratorWelcomeEmailHtml({
        departmentName: dept.name,
        organizationName: orgName,
        email,
        loginUrl: `${appUrl}/login`,
      }),
    })
  }

  revalidatePath('/super-admin')
  return { success: true, isNewUser: !existingProfile }
}
