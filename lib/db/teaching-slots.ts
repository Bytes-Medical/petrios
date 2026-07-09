import type {
  ExternalContact,
  LocationType,
  SessionStatus,
  SlotEvent,
  TeachingSlot,
} from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'
import { unwrapEmbed } from './unwrap'

/**
 * Teaching-slots DAL. teaching_slots has an org-member SELECT policy (the
 * calendar shows open slots), so reads use the RLS client. Every WRITE is
 * service-role by necessity: slots are claimed by non-moderators, and the
 * claim also has to create a session / session_teachers / teacher_invitations
 * row — all admin-only under RLS. Callers gate: moderator actions via
 * requireDepartmentModerator, member claims via slot_claim_links rows, public
 * claims via the claim_code capability token.
 *
 * Claim flow is NOT transactional (no cross-table tx on the Supabase client):
 * we claim first (atomic compare-and-set) and compensate with revertClaim if
 * the follow-up session creation fails.
 */

// -----------------------------------------------------------------------------
// Reads (RLS client)
// -----------------------------------------------------------------------------

export async function listSlotsForDepartment(
  orgId: string,
  departmentId: string
): Promise<TeachingSlot[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('teaching_slots')
    .select('*')
    .eq('org_id', orgId)
    .eq('department_id', departmentId)
    .order('date_start', { ascending: true })

  if (error) throw toDbError('Failed to list teaching slots', error)
  return (data as TeachingSlot[] | null) ?? []
}

/** OPEN future slots for calendar display. */
export async function listActiveSlotsForOrg(
  orgId: string,
  departmentId?: string
): Promise<SlotEvent[]> {
  const db = await getDb()
  let query = db
    .from('teaching_slots')
    .select('id, department_id, date_start, date_end, location_type, status')
    .eq('org_id', orgId)
    .eq('status', 'OPEN')
    .gt('date_start', new Date().toISOString())
    .order('date_start', { ascending: true })

  if (departmentId) {
    query = query.eq('department_id', departmentId)
  }

  const { data, error } = await query
  if (error) throw toDbError('Failed to list open slots', error)
  return (data as SlotEvent[] | null) ?? []
}

export async function findSlot(
  slotId: string,
  orgId: string
): Promise<TeachingSlot | null> {
  const db = await getDb()
  const { data, error } = await db
    .from('teaching_slots')
    .select('*')
    .eq('id', slotId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch slot', error)
  return (data as TeachingSlot | null) ?? null
}

// -----------------------------------------------------------------------------
// Moderator writes (service-role; action gates requireDepartmentModerator)
// -----------------------------------------------------------------------------

export async function insertSlots(input: {
  orgId: string
  departmentId: string
  createdBy: string
  locationType: LocationType
  slots: { dateStart: string; dateEnd: string }[]
}): Promise<TeachingSlot[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teaching_slots')
    .insert(
      input.slots.map((slot) => ({
        org_id: input.orgId,
        department_id: input.departmentId,
        date_start: slot.dateStart,
        date_end: slot.dateEnd,
        location_type: input.locationType,
        created_by: input.createdBy,
      }))
    )
    .select()

  if (error) {
    if (error.code === '23505') {
      throw new Error(
        'A slot already exists at one of those dates and times — it may already be open or claimed.'
      )
    }
    throw toDbError('Failed to create slots', error)
  }
  return (data as TeachingSlot[] | null) ?? []
}

export async function closeSlot(input: {
  orgId: string
  slotId: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teaching_slots')
    .update({ status: 'CLOSED' })
    .eq('id', input.slotId)
    .eq('org_id', input.orgId)
    .eq('status', 'OPEN')
    .select('id')
    .maybeSingle()

  if (error) throw toDbError('Failed to close slot', error)
  return !!data
}

export async function deleteOpenSlot(input: {
  orgId: string
  slotId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('teaching_slots')
    .delete()
    .eq('id', input.slotId)
    .eq('org_id', input.orgId)
    .in('status', ['OPEN', 'CLOSED'])

  if (error) throw toDbError('Failed to delete slot', error)
}

// -----------------------------------------------------------------------------
// Claiming (service-role; first-come-first-served)
// -----------------------------------------------------------------------------

/**
 * Atomic claim: only flips a slot that is still OPEN and in the future.
 * Returns null when someone else got there first (or it expired).
 */
export async function claimSlot(input: {
  slotId: string
  orgId: string
  claimedByUserId?: string
  claimedByContactId?: string
  claimedName: string
  topicSuggestion?: string | null
}): Promise<TeachingSlot | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('teaching_slots')
    .update({
      status: 'CLAIMED',
      claimed_by_user_id: input.claimedByUserId ?? null,
      claimed_by_contact_id: input.claimedByContactId ?? null,
      claimed_name: input.claimedName,
      claimed_at: new Date().toISOString(),
      topic_suggestion: input.topicSuggestion?.trim() || null,
    })
    .eq('id', input.slotId)
    .eq('org_id', input.orgId)
    .eq('status', 'OPEN')
    .gt('date_start', new Date().toISOString())
    .select()
    .maybeSingle()

  if (error) throw toDbError('Failed to claim slot', error)
  return (data as TeachingSlot | null) ?? null
}

/** Compensation when post-claim session creation fails. */
export async function revertClaim(slotId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('teaching_slots')
    .update({
      status: 'OPEN',
      claimed_by_user_id: null,
      claimed_by_contact_id: null,
      claimed_name: null,
      claimed_at: null,
      topic_suggestion: null,
      session_id: null,
    })
    .eq('id', slotId)
    .eq('status', 'CLAIMED')

  if (error) throw toDbError('Failed to revert claim', error)
}

export async function linkSlotSession(input: {
  slotId: string
  sessionId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('teaching_slots')
    .update({ session_id: input.sessionId })
    .eq('id', input.slotId)

  if (error) throw toDbError('Failed to link slot session', error)
}

// -----------------------------------------------------------------------------
// Publications + claim links (service-role; deny-all tables)
// -----------------------------------------------------------------------------

export interface PublicationRecipientInput {
  userId?: string
  contactId?: string
  email: string
  claimCode?: string
}

export async function insertPublication(input: {
  orgId: string
  departmentId: string
  createdBy: string
  audience: {
    groupIds: string[]
    allDepartmentMembers: boolean
    allOrgMembers: boolean
  }
  slotIds: string[]
  recipients: PublicationRecipientInput[]
}): Promise<{ publicationId: string }> {
  const db = await getServiceDb()

  const { data: publication, error: pubError } = await db
    .from('slot_publications')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      audience: input.audience,
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (pubError || !publication) {
    throw toDbError('Failed to create publication', pubError)
  }

  const { error: slotsError } = await db.from('slot_publication_slots').insert(
    input.slotIds.map((slotId) => ({
      publication_id: publication.id,
      slot_id: slotId,
    }))
  )
  if (slotsError) throw toDbError('Failed to attach slots to publication', slotsError)

  if (input.recipients.length > 0) {
    const { error: linksError } = await db.from('slot_claim_links').insert(
      input.recipients.map((r) => ({
        org_id: input.orgId,
        publication_id: publication.id,
        user_id: r.userId ?? null,
        contact_id: r.contactId ?? null,
        email: r.email,
        claim_code: r.claimCode ?? null,
      }))
    )
    if (linksError) throw toDbError('Failed to create claim links', linksError)
  }

  return { publicationId: publication.id }
}

export async function listClaimLinksForPublication(
  publicationId: string
): Promise<
  { id: string; user_id: string | null; contact_id: string | null; email: string; claim_code: string | null }[]
> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('slot_claim_links')
    .select('id, user_id, contact_id, email, claim_code')
    .eq('publication_id', publicationId)

  if (error) throw toDbError('Failed to list claim links', error)
  return (data as { id: string; user_id: string | null; contact_id: string | null; email: string; claim_code: string | null }[] | null) ?? []
}

export async function markClaimLinkEmailed(linkId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('slot_claim_links')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', linkId)

  if (error) throw toDbError('Failed to mark link emailed', error)
}

export interface ClaimLinkLookup {
  org_id: string
  publication_id: string
  contact_id: string | null
  email: string
  department_name: string | null
  contact: Pick<ExternalContact, 'first_name' | 'last_name'> | null
}

interface ClaimLinkRow {
  org_id: string
  publication_id: string
  contact_id: string | null
  email: string
  external_contacts:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null
  slot_publications:
    | { departments: { name: string } | { name: string }[] | null }
    | { departments: { name: string } | { name: string }[] | null }[]
    | null
}

/**
 * Public claim page lookup by capability code — same pattern as
 * findInvitationByCodeAndSession on the teacher-RSVP page.
 */
export async function findClaimLinkByCode(
  code: string
): Promise<ClaimLinkLookup | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('slot_claim_links')
    .select(
      'org_id, publication_id, contact_id, email, external_contacts:contact_id(first_name, last_name), slot_publications:publication_id(departments:department_id(name))'
    )
    .eq('claim_code', code)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up claim link', error)
  if (!data) return null

  const row = data as unknown as ClaimLinkRow
  const publication = unwrapEmbed(row.slot_publications)
  const department = unwrapEmbed(publication?.departments)
  const contact = unwrapEmbed(row.external_contacts)

  return {
    org_id: row.org_id,
    publication_id: row.publication_id,
    contact_id: row.contact_id,
    email: row.email,
    department_name: department?.name ?? null,
    contact,
  }
}

/** Open, future slots offered by a publication (public claim page). */
export async function listOpenSlotsForPublication(
  publicationId: string
): Promise<TeachingSlot[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('slot_publication_slots')
    .select('teaching_slots:slot_id(*)')
    .eq('publication_id', publicationId)

  if (error) throw toDbError('Failed to list publication slots', error)

  const now = Date.now()
  return (((data as { teaching_slots: TeachingSlot | TeachingSlot[] | null }[] | null) ?? [])
    .map((row) => unwrapEmbed(row.teaching_slots))
    .filter(
      (slot): slot is TeachingSlot =>
        !!slot && slot.status === 'OPEN' && new Date(slot.date_start).getTime() > now
    )
    .sort((a, b) => a.date_start.localeCompare(b.date_start)))
}

/** Open, future slots this registered user was invited to claim. */
export async function listClaimableSlotsForUser(
  userId: string,
  orgId: string
): Promise<TeachingSlot[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('slot_claim_links')
    .select('publication_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)

  if (error) throw toDbError('Failed to list claimable slots', error)
  const publicationIds = Array.from(
    new Set(((data as { publication_id: string }[] | null) ?? []).map((r) => r.publication_id))
  )
  if (publicationIds.length === 0) return []

  const { data: slotRows, error: slotsError } = await db
    .from('slot_publication_slots')
    .select('teaching_slots:slot_id(*)')
    .in('publication_id', publicationIds)

  if (slotsError) throw toDbError('Failed to list claimable slots', slotsError)

  const now = Date.now()
  const byId = new Map<string, TeachingSlot>()
  for (const row of (slotRows as { teaching_slots: TeachingSlot | TeachingSlot[] | null }[] | null) ?? []) {
    const slot = unwrapEmbed(row.teaching_slots)
    if (slot && slot.status === 'OPEN' && new Date(slot.date_start).getTime() > now) {
      byId.set(slot.id, slot)
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.date_start.localeCompare(b.date_start)
  )
}

/** Whether this recipient was offered this slot via any publication. */
export async function hasClaimLinkForSlot(input: {
  slotId: string
  userId?: string
  contactId?: string
  publicationId?: string
}): Promise<boolean> {
  const db = await getServiceDb()

  let linksQuery = db.from('slot_claim_links').select('publication_id')
  if (input.publicationId) linksQuery = linksQuery.eq('publication_id', input.publicationId)
  if (input.userId) linksQuery = linksQuery.eq('user_id', input.userId)
  if (input.contactId) linksQuery = linksQuery.eq('contact_id', input.contactId)

  const { data: links, error: linksError } = await linksQuery
  if (linksError) throw toDbError('Failed to check claim authorization', linksError)

  const publicationIds = Array.from(
    new Set(((links as { publication_id: string }[] | null) ?? []).map((r) => r.publication_id))
  )
  if (publicationIds.length === 0) return false

  const { data, error } = await db
    .from('slot_publication_slots')
    .select('slot_id')
    .eq('slot_id', input.slotId)
    .in('publication_id', publicationIds)
    .limit(1)

  if (error) throw toDbError('Failed to check claim authorization', error)
  return ((data as unknown[] | null) ?? []).length > 0
}

// -----------------------------------------------------------------------------
// Claim-time system writes. RLS forbids non-moderators inserting sessions /
// session_teachers / teacher_invitations, so the claim flow performs them via
// the service role. Kept here (not in lib/db/sessions.ts) so the widened
// blast radius stays documented in one module.
// -----------------------------------------------------------------------------

export async function insertClaimedSessionAsSystem(input: {
  orgId: string
  departmentId: string
  title: string
  dateStart: string
  dateEnd: string
  locationType: LocationType
  createdBy: string
}): Promise<{ id: string; status: SessionStatus }> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('sessions')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      title: input.title,
      date_start: input.dateStart,
      date_end: input.dateEnd,
      location_type: input.locationType,
      status: 'DRAFT',
      created_by: input.createdBy,
    })
    .select('id, status')
    .single()

  if (error) throw toDbError('Failed to create session for slot', error)
  return data as { id: string; status: SessionStatus }
}

export async function insertAcceptedSessionTeacherAsSystem(input: {
  orgId: string
  sessionId: string
  userId: string
  invitedBy: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('session_teachers').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    user_id: input.userId,
    status: 'ACCEPTED',
    invited_by: input.invitedBy,
    responded_at: new Date().toISOString(),
  })

  if (error) throw toDbError('Failed to attach teacher to session', error)
}

export async function insertAcceptedExternalInvitationAsSystem(input: {
  orgId: string
  sessionId: string
  email: string
  firstName: string
  lastName: string
  inviteCode: string
  sentBy: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('teacher_invitations').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
    invite_code: input.inviteCode,
    status: 'ACCEPTED',
    sent_by: input.sentBy,
    responded_at: new Date().toISOString(),
  })

  if (error) throw toDbError('Failed to attach external teacher', error)
}
