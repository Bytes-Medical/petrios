import type { ContactGroupWithCount, ExternalContact } from '@/lib/types'
import { mergeContactNames, normalizeContactEmail } from '@/lib/contacts'
import { getServiceDb } from './client'
import { DbNotFoundError, toDbError } from './errors'
import { unwrapEmbed } from './unwrap'

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

async function findContactByEmail(
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

async function insertContact(input: {
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

export async function findContactEmail(
  contactId: string,
  orgId: string
): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('external_contacts')
    .select('email')
    .eq('id', contactId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up contact', error)
  return (data as { email: string } | null)?.email ?? null
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

  // A membership row planted before addContactToGroup checked ownership could
  // point at another tenant's contact: only this organisation's contacts count.
  return ((data as { external_contacts: ExternalContact | ExternalContact[] | null }[] | null) ?? [])
    .map((row) => unwrapEmbed(row.external_contacts))
    .filter((c): c is ExternalContact => !!c && c.org_id === orgId)
}

/**
 * Adds a contact to a group after checking that BOTH belong to `orgId`: the
 * membership table has no composite foreign keys, so without this check a
 * manager could attach another tenant's contact (and read it back through
 * the group) by id. Throws DbNotFoundError when either is foreign or missing.
 */
export async function addContactToGroup(input: {
  orgId: string
  groupId: string
  contactId: string
}): Promise<void> {
  const db = await getServiceDb()
  const [groupRes, contactRes] = await Promise.all([
    db
      .from('contact_groups')
      .select('id')
      .eq('id', input.groupId)
      .eq('org_id', input.orgId)
      .maybeSingle(),
    db
      .from('external_contacts')
      .select('id')
      .eq('id', input.contactId)
      .eq('org_id', input.orgId)
      .maybeSingle(),
  ])
  if (groupRes.error) throw toDbError('Failed to look up contact group', groupRes.error)
  if (contactRes.error) throw toDbError('Failed to look up contact', contactRes.error)
  if (!groupRes.data) throw new DbNotFoundError('Contact group not found')
  if (!contactRes.data) throw new DbNotFoundError('Contact not found')

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
      const group = unwrapEmbed(row.contact_groups)
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
    const contact = unwrapEmbed(row.external_contacts)
    // Never fan out to another tenant's contact (see listGroupMemberContacts).
    if (contact && contact.org_id === orgId && !contact.archived_at) {
      byId.set(contact.id, contact)
    }
  }
  return Array.from(byId.values())
}
