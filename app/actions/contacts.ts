'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg, requireOrgManager } from '@/lib/auth'
import * as contactsDb from '@/lib/db/external-contacts'

export async function getAddressBook() {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  const [contacts, groups, membershipPairs] = await Promise.all([
    contactsDb.listContacts(orgId, { includeArchived: true }),
    contactsDb.listGroupsWithCounts(orgId),
    contactsDb.listGroupMembershipPairs(orgId),
  ])

  const groupsByContact: Record<string, string[]> = {}
  for (const pair of membershipPairs) {
    ;(groupsByContact[pair.contact_id] ??= []).push(pair.group_name)
  }

  return { contacts, groups, groupsByContact }
}

/** Autocomplete source for ContactPicker. */
export async function searchAddressBook(query: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  return contactsDb.searchContacts(orgId, trimmed)
}

export async function createContact(input: {
  email: string
  firstName?: string
  lastName?: string
  roleNote?: string
}) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  if (!input.email.trim()) {
    throw new Error('Email is required')
  }

  const contact = await contactsDb.upsertContactByEmail({
    orgId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    roleNote: input.roleNote,
    createdBy: userId,
    overwriteNames: true,
  })

  revalidatePath('/settings')
  return contact
}

export async function updateContactDetails(
  contactId: string,
  input: { firstName?: string; lastName?: string; roleNote?: string }
) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  await contactsDb.updateContact({
    orgId,
    contactId,
    firstName: input.firstName,
    lastName: input.lastName,
    roleNote: input.roleNote,
  })
  revalidatePath('/settings')
  return { success: true }
}

export async function archiveContact(contactId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  await contactsDb.setContactArchived({ orgId, contactId, archived: true })
  revalidatePath('/settings')
  return { success: true }
}

export async function restoreContact(contactId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  await contactsDb.setContactArchived({ orgId, contactId, archived: false })
  revalidatePath('/settings')
  return { success: true }
}

export async function createContactGroup(name: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  if (!name.trim()) throw new Error('Group name is required')
  await contactsDb.insertGroup({ orgId, name, createdBy: userId })
  revalidatePath('/settings')
  return { success: true }
}

export async function renameContactGroup(groupId: string, name: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)

  if (!name.trim()) throw new Error('Group name is required')
  await contactsDb.renameGroup({ orgId, groupId, name })
  revalidatePath('/settings')
  return { success: true }
}

export async function deleteContactGroup(groupId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  await contactsDb.deleteGroup({ orgId, groupId })
  revalidatePath('/settings')
  return { success: true }
}

export async function getContactGroupMembers(groupId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  return contactsDb.listGroupMemberContacts(orgId, groupId)
}

export async function addContactToGroup(groupId: string, contactId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  await contactsDb.addContactToGroup({ orgId, groupId, contactId })
  revalidatePath('/settings')
  return { success: true }
}

export async function removeContactFromGroup(groupId: string, contactId: string) {
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  await contactsDb.removeContactFromGroup({ orgId, groupId, contactId })
  revalidatePath('/settings')
  return { success: true }
}
