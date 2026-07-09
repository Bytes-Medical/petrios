import type { ContactGroupWithCount, ExternalContact } from '@/lib/types'
import { mergeContactNames, normalizeContactEmail } from '@/lib/contacts'
import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Address-book DAL. The external_contacts / contact_groups /
 * contact_group_members tables are deny-all under RLS by design (034), so
 * every function here uses the service-role client. Callers MUST gate with
 * requireOrgManager() in server actions — except upsertContactByEmail, which
 * also runs inside already-authorized invitation flows and the public RSVP /
 * slot-claim responders (capability-code scoped).
 */

// -----------------------------------------------------------------------------
// Contacts
// -----------------------------------------------------------------------------

export async function listContacts(
  orgId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<ExternalContact[]> {
  const db = await getServiceDb()
  let query = db
    .from('external_contacts')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (!opts.includeArchived) {
    query = query.is('archived_at', null)
  }

  const { data, error } = await query
  if (error) throw toDbError('Failed to list contacts', error)
  return (data as ExternalContact[] | null) ?? []
}

export async function searchContacts(
  orgId: string,
  query: string,
  limit = 8
): Promise<ExternalContact[]> {
  const db = await getServiceDb()
  const q = `%${query}%`
  const { data, error } = await db
    .from('external_contacts')
    .select('*')
    .eq('org_id', orgId)
    .is('archived_at', null)
    .or(`email.ilike.${q},first_name.ilike.${q},last_name.ilike.${q}`)
    .limit(limit)

  if (error) throw toDbError('Failed to search contacts', error)
  return (data as ExternalContact[] | null) ?? []
}

export async function findContactByEmail(
  orgId: string,
  email: string
): Promise<ExternalContact | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('external_contacts')
    .select('*')
    .eq('org_id', orgId)
    .ilike('email', normalizeContactEmail(email))
    .maybeSingle()

  if (error) throw toDbError('Failed to look up contact', error)
  return (data as ExternalContact | null) ?? null
}

export async function insertContact(input: {
  orgId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  roleNote?: string | null
  createdBy?: string | null
}): Promise<ExternalContact> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('external_contacts')
    .insert({
      org_id: input.orgId,
      email: normalizeContactEmail(input.email),
      first_name: input.firstName?.trim() || null,
      last_name: input.lastName?.trim() || null,
      role_note: input.roleNote?.trim() || null,
      created_by: input.createdBy ?? null,
    })
    .select()
    .single()

  if (error) throw toDbError('Failed to add contact', error)
  return data as ExternalContact
}

export async function updateContact(input: {
  orgId: string
  contactId: string
  firstName?: string | null
  lastName?: string | null
  roleNote?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('external_contacts')
    .update({
      first_name: input.firstName?.trim() || null,
      last_name: input.lastName?.trim() || null,
      role_note: input.roleNote?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.contactId)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to update contact', error)
}

export async function setContactArchived(input: {
  orgId: string
  contactId: string
  archived: boolean
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('external_contacts')
    .update({
      archived_at: input.archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.contactId)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to update contact', error)
}

/**
 * Find-or-create by email, merging name details per lib/contacts semantics
 * (overwriteNames: self-reported values win; otherwise fill blanks only).
 * The unique (org_id, lower(email)) index is the race backstop: on conflict
 * we re-read and update instead.
 */
export async function upsertContactByEmail(input: {
  orgId: string
  email: string
  firstName?: string | null
  lastName?: string | null
  roleNote?: string | null
  createdBy?: string | null
  overwriteNames: boolean
}): Promise<ExternalContact> {
  const existing = await findContactByEmail(input.orgId, input.email)

  if (!existing) {
    try {
      return await insertContact(input)
    } catch {
      // Lost an insert race — fall through to the update path.
    }
  }

  const contact = existing ?? (await findContactByEmail(input.orgId, input.email))
  if (!contact) throw new Error('Failed to save contact')

  const update = mergeContactNames(
    contact,
    { firstName: input.firstName, lastName: input.lastName, roleNote: input.roleNote },
    { overwriteNames: input.overwriteNames }
  )

  // Re-activate archived contacts that get invited again.
  if (Object.keys(update).length === 0 && !contact.archived_at) return contact

  const db = await getServiceDb()
  const { data, error } = await db
    .from('external_contacts')
    .update({ ...update, archived_at: null, updated_at: new Date().toISOString() })
    .eq('id', contact.id)
    .select()
    .single()

  if (error) throw toDbError('Failed to update contact', error)
  return data as ExternalContact
}

// -----------------------------------------------------------------------------
// Groups
// -----------------------------------------------------------------------------

export async function listGroupsWithCounts(
  orgId: string
): Promise<ContactGroupWithCount[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('contact_groups')
    .select('*, contact_group_members(count)')
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (error) throw toDbError('Failed to list contact groups', error)

  return ((data as Record<string, unknown>[] | null) ?? []).map((row) => {
    const counts = row.contact_group_members as { count: number }[] | null
    const { contact_group_members: _members, ...group } = row
    return {
      ...(group as Omit<ContactGroupWithCount, 'member_count'>),
      member_count: counts?.[0]?.count ?? 0,
    }
  })
}

export async function insertGroup(input: {
  orgId: string
  name: string
  createdBy: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('contact_groups').insert({
    org_id: input.orgId,
    name: input.name.trim(),
    created_by: input.createdBy,
  })

  if (error) throw toDbError('Failed to create group', error)
}

export async function renameGroup(input: {
  orgId: string
  groupId: string
  name: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('contact_groups')
    .update({ name: input.name.trim() })
    .eq('id', input.groupId)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to rename group', error)
}

export async function deleteGroup(input: {
  orgId: string
  groupId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('contact_groups')
    .delete()
    .eq('id', input.groupId)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to delete group', error)
}

export async function listGroupMemberContacts(
  orgId: string,
  groupId: string
): Promise<ExternalContact[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('contact_group_members')
    .select('external_contacts:contact_id(*)')
    .eq('org_id', orgId)
    .eq('group_id', groupId)

  if (error) throw toDbError('Failed to list group members', error)

  return ((data as { external_contacts: ExternalContact | ExternalContact[] | null }[] | null) ?? [])
    .map((row) =>
      Array.isArray(row.external_contacts)
        ? row.external_contacts[0]
        : row.external_contacts
    )
    .filter((c): c is ExternalContact => !!c)
}

export async function addContactToGroup(input: {
  orgId: string
  groupId: string
  contactId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('contact_group_members').insert({
    org_id: input.orgId,
    group_id: input.groupId,
    contact_id: input.contactId,
  })

  // Idempotent: adding an existing member is not an error.
  if (error && error.code !== '23505') {
    throw toDbError('Failed to add contact to group', error)
  }
}

export async function removeContactFromGroup(input: {
  orgId: string
  groupId: string
  contactId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('contact_group_members')
    .delete()
    .eq('org_id', input.orgId)
    .eq('group_id', input.groupId)
    .eq('contact_id', input.contactId)

  if (error) throw toDbError('Failed to remove contact from group', error)
}

/** All (contact_id, group name) pairs for the org — used for group chips. */
export async function listGroupMembershipPairs(
  orgId: string
): Promise<{ contact_id: string; group_name: string }[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('contact_group_members')
    .select('contact_id, contact_groups:group_id(name)')
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to list group memberships', error)

  return ((data as { contact_id: string; contact_groups: { name: string } | { name: string }[] | null }[] | null) ?? [])
    .map((row) => {
      const group = Array.isArray(row.contact_groups)
        ? row.contact_groups[0]
        : row.contact_groups
      return group ? { contact_id: row.contact_id, group_name: group.name } : null
    })
    .filter((r): r is { contact_id: string; group_name: string } => !!r)
}

/** Distinct active contacts across the given groups (publication fan-out). */
export async function listContactsInGroups(
  orgId: string,
  groupIds: string[]
): Promise<ExternalContact[]> {
  if (groupIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('contact_group_members')
    .select('contact_id, external_contacts:contact_id(*)')
    .eq('org_id', orgId)
    .in('group_id', groupIds)

  if (error) throw toDbError('Failed to resolve group contacts', error)

  const byId = new Map<string, ExternalContact>()
  for (const row of (data as { external_contacts: ExternalContact | ExternalContact[] | null }[] | null) ?? []) {
    const contact = Array.isArray(row.external_contacts)
      ? row.external_contacts[0]
      : row.external_contacts
    if (contact && !contact.archived_at) byId.set(contact.id, contact)
  }
  return Array.from(byId.values())
}
